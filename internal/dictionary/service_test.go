package dictionary

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func testService(t *testing.T) *Service {
	t.Helper()
	service, err := Open(filepath.Join(t.TempDir(), "dictionary.db"))
	if err != nil {
		t.Fatal(err)
	}
	service.fallbackEndpoint = ""
	t.Cleanup(func() { service.Close() })
	return service
}

func fixture(word string) string {
	return fmt.Sprintf(`[{"word":%q,"phonetics":[{"text":"/test/","audio":"https://example.com/recording.mp3"}],"meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"A test word.","example":"This is a test."}]}],"license":{"name":"CC BY-SA 3.0"},"sourceUrls":["https://en.wiktionary.org"]}]`, word)
}

func TestNormalize(t *testing.T) {
	for _, input := range []string{" Hello ", "DON'T", "ice cream", "well-being"} {
		if _, err := Normalize(input); err != nil {
			t.Errorf("%q: %v", input, err)
		}
	}
	for _, input := range []string{"", " ", "你好", "hello123", "<script>", "--hello", "word\nword", strings.Repeat("a", 101)} {
		if _, err := Normalize(input); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
}

func TestLookupPersistsAndNeverFetchesCachedWord(t *testing.T) {
	service := testService(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write([]byte(fixture("hello")))
	}))
	service.endpoint = server.URL + "/"
	entry, err := service.Lookup(context.Background(), " Hello ")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Cached || entry.Word != "hello" || entry.Phonetic != "/test/" || entry.SavedAt == "" {
		t.Fatalf("unexpected entry: %+v", entry)
	}
	server.Close()
	cached, err := service.Lookup(context.Background(), "HELLO")
	if err != nil {
		t.Fatal(err)
	}
	if !cached.Cached || cached.SavedAt != entry.SavedAt || calls.Load() != 1 {
		t.Fatalf("cache missed: %+v, calls=%d", cached, calls.Load())
	}
	path := service.db
	var stored string
	if err = path.QueryRow("SELECT entry FROM words").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, "base64") {
		t.Fatal("audio persisted in database")
	}
}

func TestReopenDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "with spaces", "dictionary.db")
	service, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(fixture("hello"))) }))
	service.endpoint = server.URL + "/"
	if _, err := service.Lookup(context.Background(), "hello"); err != nil {
		t.Fatal(err)
	}
	server.Close()
	service.Close()
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	entry, err := reopened.Lookup(context.Background(), "hello")
	if err != nil || !entry.Cached {
		t.Fatalf("reopen failed: %+v %v", entry, err)
	}
}

func TestConcurrentLookupUsesOneRequest(t *testing.T) {
	service := testService(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write([]byte(fixture("hello")))
	}))
	defer server.Close()
	service.endpoint = server.URL + "/"
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := service.Lookup(context.Background(), "hello"); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	if calls.Load() != 1 {
		t.Fatalf("requests=%d", calls.Load())
	}
}

func TestListOrdering(t *testing.T) {
	service := testService(t)
	for i, word := range []string{"zebra", "apple", "hello"} {
		var entries []Entry
		json.Unmarshal([]byte(fixture(word)), &entries)
		entries[0].SavedAt = fmt.Sprintf("2026-10-%02dT00:00:00Z", i+1)
		data, _ := json.Marshal(entries[0])
		if _, err := service.db.Exec("INSERT INTO words VALUES(?,?,?)", word, string(data), entries[0].SavedAt); err != nil {
			t.Fatal(err)
		}
	}
	for order, expected := range map[string]string{"alphabetical": "apple,hello,zebra", "newest": "hello,apple,zebra", "oldest": "zebra,apple,hello"} {
		rows, err := service.List(context.Background(), order)
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, row := range rows {
			names = append(names, row.Word)
			if row.Brief != "A test word." {
				t.Fatal("missing brief")
			}
		}
		if strings.Join(names, ",") != expected {
			t.Fatalf("%s: %v", order, names)
		}
	}
	if _, err := service.List(context.Background(), "word; DROP TABLE words"); err == nil {
		t.Fatal("accepted invalid order")
	}
}

func TestProviderErrorsDoNotSave(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"not-found", 404, "{}"}, {"rate-limit", 429, "{}"}, {"server", 503, "{}"},
		{"bad-json", 200, "<html>error</html>"}, {"empty", 200, "[]"}, {"no-meanings", 200, `[{"word":"hello"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := testService(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); w.Write([]byte(tc.body)) }))
			defer server.Close()
			service.endpoint = server.URL + "/"
			if _, err := service.Lookup(context.Background(), "hello"); err == nil {
				t.Fatal("expected error")
			}
			rows, err := service.List(context.Background(), "newest")
			if err != nil || len(rows) != 0 {
				t.Fatal("failed lookup stored an entry")
			}
		})
	}
}

func TestHomographs(t *testing.T) {
	service := testService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		first := fixture("read")
		w.Write([]byte(first[:len(first)-1] + "," + first[1:]))
	}))
	defer server.Close()
	service.endpoint = server.URL + "/"
	entry, err := service.Lookup(context.Background(), "read")
	if err != nil {
		t.Fatal(err)
	}
	if len(entry.Meanings) != 2 || len(entry.Phonetics) != 2 {
		t.Fatal("homograph data lost")
	}
}

func TestPronounceIsNetworkOnlyAndDoesNotPersist(t *testing.T) {
	service := testService(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("audio") != "hello" || r.Header.Get("Cache-Control") != "no-store" {
			t.Error("missing word or no-store header")
		}
		if r.URL.Query().Get("type") != "1" && r.URL.Query().Get("type") != "2" {
			t.Error("invalid accent")
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Write([]byte("ID3-audio-test"))
	}))
	defer server.Close()
	service.audioEndpoint = server.URL
	for _, accent := range []string{"uk", "us", "us"} {
		audio, err := service.Pronounce(context.Background(), "HELLO", accent)
		if err != nil || !strings.HasPrefix(audio, "data:audio/mpeg;base64,") {
			t.Fatalf("%s %v", audio, err)
		}
	}
	if calls.Load() != 3 {
		t.Fatalf("unexpected audio caching: %d", calls.Load())
	}
	rows, _ := service.List(context.Background(), "newest")
	if len(rows) != 0 {
		t.Fatal("audio call created database entries")
	}
	var filename string
	if err := service.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&filename); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(filepath.Dir(filename))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if !strings.HasPrefix(file.Name(), "dictionary.db") {
			t.Fatalf("unexpected persisted file: %s", file.Name())
		}
	}
	if _, err := service.Pronounce(context.Background(), "hello", "other"); err == nil {
		t.Fatal("accepted invalid accent")
	}
}

func TestInvalidAudio(t *testing.T) {
	for _, tc := range []struct {
		name, mime, body string
		status           int
	}{
		{"html", "text/html", "<html>", 200}, {"empty", "audio/mpeg", "", 200},
		{"large", "audio/mpeg", strings.Repeat("a", (6<<20)+1), 200}, {"server", "audio/mpeg", "error", 522},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := testService(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.mime)
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer server.Close()
			service.audioEndpoint = server.URL
			if _, err := service.Pronounce(context.Background(), "hello", "us"); err == nil {
				t.Fatal("accepted invalid audio")
			}
		})
	}
}

func TestCancelledRequests(t *testing.T) {
	service := testService(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Lookup(ctx, "hello"); err == nil {
		t.Fatal("cancel ignored")
	}
	if _, err := service.Pronounce(ctx, "hello", "us"); err == nil {
		t.Fatal("audio cancel ignored")
	}
}

func TestFallbackKeepsTextOnlyAndRejectsSuggestions(t *testing.T) {
	service := testService(t)
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer first.Close()
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		word := r.URL.Query().Get("q")
		fmt.Fprintf(w, `{"ec":{"word":[{"usphone":"test","ukphone":"test-uk","return-phrase":{"l":{"i":"apple"}},"trs":[{"tr":[{"l":{"i":["n. A fruit."]}}]}]}]},"blng_sents_part":{"sentence-pair":[{"sentence":"An apple.","sentence-translation":"A fruit example.","source":"Test source"}]},"oxfordAdvanceHtml":{"encryptedData":"do-not-consume-%s"}}`, word)
	}))
	defer backup.Close()
	service.endpoint = first.URL + "/"
	service.fallbackEndpoint = backup.URL
	entry, err := service.Lookup(context.Background(), "apple")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Provider != "有道词典" || len(entry.Examples) != 1 || entry.Phonetics[0].Accent != "us" {
		t.Fatalf("missing fallback metadata: %+v", entry)
	}
	var stored string
	service.db.QueryRow("SELECT entry FROM words WHERE word='apple'").Scan(&stored)
	if strings.Contains(stored, "encryptedData") || strings.Contains(stored, "do-not-consume") || strings.Contains(stored, "base64") {
		t.Fatal("unexpected persisted provider data")
	}
	cached, err := service.Lookup(context.Background(), "apple")
	if err != nil || !cached.Cached {
		t.Fatal("fallback cache failed")
	}
	if _, err := service.Lookup(context.Background(), "appl"); err == nil {
		t.Fatal("accepted spelling suggestion as exact lookup")
	}
}

func TestLiveProviders(t *testing.T) {
	if os.Getenv("LIVE_DICTIONARY_TEST") != "1" {
		t.Skip("set LIVE_DICTIONARY_TEST=1 to test public providers")
	}
	service := testService(t)
	service.fallbackEndpoint = "https://dict.youdao.com/jsonapi"
	for _, word := range []string{"hello", "apple"} {
		entry, err := service.Lookup(context.Background(), word)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: %d meanings", word, len(entry.Meanings))
		for _, accent := range []string{"us", "uk"} {
			data, err := service.Pronounce(context.Background(), word, accent)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("%s %s: %d encoded audio bytes (memory only)", word, accent, len(data))
		}
	}
}
