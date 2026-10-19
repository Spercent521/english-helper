package dictionary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

func TestSourcesMergePersistAndRemainOffline(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dictionary.db")
	service, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	var calls atomic.Int32
	free := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write([]byte(fixture("hello")))
	}))
	youdao := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write([]byte(`{"ec":{"word":[{"return-phrase":{"l":{"i":"hello"}},"trs":[{"tr":[{"l":{"i":["Other source definition"]}}]}]}]}}`))
	}))
	service.endpoint = free.URL + "/"
	service.fallbackEndpoint = youdao.URL
	var group sync.WaitGroup
	for _, provider := range []string{"Free Dictionary API", "有道词典"} {
		group.Add(1)
		go func(provider string) {
			defer group.Done()
			if _, err := service.LookupSource(context.Background(), "hello", provider); err != nil {
				t.Error(err)
			}
		}(provider)
	}
	group.Wait()
	free.Close()
	youdao.Close()
	entry, err := service.Cached(context.Background(), "hello")
	if err != nil || len(entry.Sources) != 2 {
		t.Fatalf("sources overwritten: %+v %v", entry, err)
	}
	saved := entry.SavedAt
	if calls.Load() != 2 {
		t.Fatalf("unexpected calls: %d", calls.Load())
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	for _, provider := range []string{"Free Dictionary API", "有道词典"} {
		entry, err = reopened.LookupSource(context.Background(), "hello", provider)
		if err != nil || !entry.Cached || entry.SavedAt != saved {
			t.Fatalf("cache miss: %+v %v", entry, err)
		}
	}
	rows, _ := reopened.List(context.Background(), "newest")
	if len(rows) != 1 {
		t.Fatalf("multiple rows for one word: %d", len(rows))
	}
	if entry.Sources[0].Meanings[0].Definitions[0].Definition == entry.Sources[1].Meanings[0].Definitions[0].Definition {
		t.Fatal("independent meanings lost")
	}
}

func TestLegacySourceUpgradeDoesNotFetchUntilRequested(t *testing.T) {
	service := testService(t)
	var entries []Entry
	json.Unmarshal([]byte(fixture("hello")), &entries)
	legacy := entries[0]
	legacy.SavedAt = "2026-10-12T00:00:00Z"
	data, _ := json.Marshal(legacy)
	service.db.Exec("INSERT INTO words VALUES(?,?,?)", "hello", string(data), legacy.SavedAt)
	entry, err := service.Cached(context.Background(), "HELLO")
	if err != nil || len(entry.Sources) != 1 || entry.Sources[0].Provider != "Free Dictionary API" {
		t.Fatalf("legacy source missing: %+v %v", entry, err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ec":{"word":[{"return-phrase":{"l":{"i":"hello"}},"trs":[{"tr":[{"l":{"i":["A greeting"]}}]}]}]}}`))
	}))
	defer server.Close()
	service.fallbackEndpoint = server.URL
	entry, err = service.LookupSource(context.Background(), "hello", "有道词典")
	if err != nil || len(entry.Sources) != 2 || entry.SavedAt != legacy.SavedAt {
		t.Fatalf("%+v %v", entry, err)
	}
	if _, err := service.LookupSource(context.Background(), "hello", "unknown"); err == nil {
		t.Fatal("unknown provider accepted")
	}
}

func TestFailedSourcePreservesSavedResultsAndCanRetry(t *testing.T) {
	service := testService(t)
	free := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(fixture("hello"))) }))
	defer free.Close()
	service.endpoint = free.URL + "/"
	if _, err := service.LookupSource(context.Background(), "hello", "Free Dictionary API"); err != nil {
		t.Fatal(err)
	}
	var fails atomic.Bool
	fails.Store(true)
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fails.Load() {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte(`{"ec":{"word":[{"return-phrase":{"l":{"i":"hello"}},"trs":[{"tr":[{"l":{"i":["A greeting"]}}]}]}]}}`))
	}))
	defer backup.Close()
	service.fallbackEndpoint = backup.URL
	if _, err := service.LookupSource(context.Background(), "hello", "有道词典"); err == nil {
		t.Fatal("expected failure")
	}
	entry, _ := service.Cached(context.Background(), "hello")
	if len(entry.Sources) != 1 {
		t.Fatal("saved results changed on failure")
	}
	fails.Store(false)
	entry, err := service.LookupSource(context.Background(), "hello", "有道词典")
	if err != nil || len(entry.Sources) != 2 {
		t.Fatalf("retry failed: %+v %v", entry, err)
	}
}
