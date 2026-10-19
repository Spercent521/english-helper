package dictionary

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Definition struct {
	Definition string `json:"definition"`
	Example    string `json:"example"`
}

type Meaning struct {
	PartOfSpeech string       `json:"partOfSpeech"`
	Definitions  []Definition `json:"definitions"`
}

type Phonetic struct {
	Text   string `json:"text"`
	Audio  string `json:"audio"`
	Accent string `json:"accent,omitempty"`
}

type License struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type Example struct {
	Sentence    string `json:"sentence"`
	Translation string `json:"translation"`
	Source      string `json:"source"`
}

type Entry struct {
	Word      string        `json:"word"`
	Phonetic  string        `json:"phonetic"`
	Phonetics []Phonetic    `json:"phonetics"`
	Meanings  []Meaning     `json:"meanings"`
	Source    []string      `json:"sourceUrls"`
	License   License       `json:"license"`
	Provider  string        `json:"provider"`
	Examples  []Example     `json:"examples,omitempty"`
	SavedAt   string        `json:"savedAt"`
	Cached    bool          `json:"cached"`
	Sources   []SourceEntry `json:"sources,omitempty"`
}

type Summary struct {
	Word     string `json:"word"`
	Phonetic string `json:"phonetic"`
	Brief    string `json:"brief"`
	SavedAt  string `json:"savedAt"`
}

type Service struct {
	db               *sql.DB
	client           *http.Client
	endpoint         string
	audioEndpoint    string
	fallbackEndpoint string
	mu               sync.Mutex
}

var validWord = regexp.MustCompile(`^[a-z]+(?:[ '-][a-z]+)*$`)

func Normalize(word string) (string, error) {
	word = strings.ToLower(strings.TrimSpace(word))
	if len(word) > 100 || !validWord.MatchString(word) {
		return "", errors.New("请输入英文单词或短语，仅支持英文字母、空格、连字符和撇号")
	}
	return word, nil
}

func Open(path string) (*Service, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	dsn := (&url.URL{Scheme: "file", Path: path}).String() + "?_busy_timeout=5000&_journal_mode=WAL"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS words (
		word TEXT PRIMARY KEY, entry TEXT NOT NULL, saved_at TEXT NOT NULL
	)`); err != nil {
		db.Close()
		return nil, err
	}
	return &Service{db: db, client: &http.Client{Timeout: 15 * time.Second},
		endpoint:         "https://api.dictionaryapi.dev/api/v2/entries/en/",
		audioEndpoint:    "https://dict.youdao.com/dictvoice",
		fallbackEndpoint: "https://dict.youdao.com/jsonapi"}, nil
}

func (s *Service) Close() error { return s.db.Close() }

func (s *Service) Lookup(ctx context.Context, input string) (Entry, error) {
	word, err := Normalize(input)
	if err != nil {
		return Entry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var stored string
	err = s.db.QueryRowContext(ctx, "SELECT entry FROM words WHERE word = ?", word).Scan(&stored)
	if err == nil {
		var entry Entry
		if err = json.Unmarshal([]byte(stored), &entry); err != nil {
			return Entry{}, fmt.Errorf("本地词条读取失败: %w", err)
		}
		entry.Cached = true
		return entry, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Entry{}, fmt.Errorf("数据库读取失败: %w", err)
	}
	entry, err := s.fetchOnline(ctx, word)
	if err != nil {
		return Entry{}, err
	}
	entry.Word = word
	entry.SavedAt = time.Now().UTC().Format(time.RFC3339Nano)
	for i := range entry.Phonetics {
		p := &entry.Phonetics[i]
		if entry.Phonetic == "" && p.Text != "" {
			entry.Phonetic = p.Text
		}
		// Store metadata only. Audio is requested separately when the user plays it.
		if strings.HasPrefix(p.Audio, "data:") {
			p.Audio = ""
		}
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return Entry{}, err
	}
	if _, err = s.db.ExecContext(ctx, "INSERT INTO words(word, entry, saved_at) VALUES(?, ?, ?)", word, string(data), entry.SavedAt); err != nil {
		return Entry{}, fmt.Errorf("保存单词失败: %w", err)
	}
	return entry, nil
}

var errNotFound = errors.New("词典中未找到这个单词，请检查拼写")

func (s *Service) fetchOnline(ctx context.Context, word string) (Entry, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	type result struct {
		entry Entry
		err   error
	}
	providers := []func(context.Context, string) (Entry, error){s.fetchFree}
	if s.fallbackEndpoint != "" {
		providers = append(providers, s.fetchFallback)
	}
	// Let a working provider complete immediately; cancellation stops the loser.
	// Buffer every result so a late response cannot leave a blocked goroutine.
	results := make(chan result, len(providers))
	for _, provider := range providers {
		go func(fetch func(context.Context, string) (Entry, error)) {
			entry, err := fetch(ctx, word)
			results <- result{entry, err}
		}(provider)
	}
	notFound := false
	for range providers {
		select {
		case <-ctx.Done():
			if notFound && errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return Entry{}, errNotFound
			}
			return Entry{}, errors.New("在线查询超时或已取消，请稍后重试；已保存的单词仍可离线查看")
		case reply := <-results:
			if reply.err == nil {
				return reply.entry, nil
			}
			notFound = notFound || errors.Is(reply.err, errNotFound)
		}
	}
	if notFound {
		return Entry{}, errNotFound
	}
	return Entry{}, errors.New("两个在线词典均未能返回有效结果，可能是服务或网络异常，请稍后重试；已保存的单词仍可离线查看")
}

func (s *Service) fetchFree(ctx context.Context, word string) (Entry, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(queryCtx, http.MethodGet, s.endpoint+url.PathEscape(word), nil)
	if err != nil {
		return Entry{}, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return Entry{}, errors.New("无法连接词典服务，请检查网络后重试；已保存的单词仍可离线查看")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return Entry{}, errNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return Entry{}, fmt.Errorf("词典服务暂时不可用（%d），请稍后重试", resp.StatusCode)
	}
	var entries []Entry
	if err = json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&entries); err != nil || len(entries) == 0 {
		return Entry{}, errors.New("词典返回了无效数据，请稍后重试")
	}
	entry := entries[0]
	if len(entry.Meanings) == 0 {
		return Entry{}, errors.New("词典未返回释义")
	}
	// Homographs may be separate API entries; preserve all meanings and pronunciations.
	for _, extra := range entries[1:] {
		entry.Meanings = append(entry.Meanings, extra.Meanings...)
		entry.Phonetics = append(entry.Phonetics, extra.Phonetics...)
	}
	entry.Provider = "Free Dictionary API"
	return entry, nil
}

func (s *Service) Pronounce(ctx context.Context, input, accent string) (string, error) {
	word, err := Normalize(input)
	if err != nil {
		return "", err
	}
	voice := "2"
	switch accent {
	case "us":
	case "uk":
		voice = "1"
	default:
		return "", errors.New("无效的发音类型")
	}
	u, err := url.Parse(s.audioEndpoint)
	if err != nil {
		return "", err
	}
	query := u.Query()
	query.Set("audio", word)
	query.Set("type", voice)
	u.RawQuery = query.Encode()
	audioCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(audioCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Cache-Control", "no-store")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", errors.New("无法获取在线发音，请检查网络后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("发音服务暂时不可用（%d）", resp.StatusCode)
	}
	mime := strings.Split(resp.Header.Get("Content-Type"), ";")[0]
	if !strings.HasPrefix(mime, "audio/") && mime != "application/ogg" {
		return "", errors.New("发音服务未返回有效音频")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (6<<20)+1))
	if err != nil || len(data) == 0 || len(data) > 6<<20 {
		return "", errors.New("发音音频无效或超过大小限制")
	}
	// The bytes exist only in this response and the player's memory; never write them to disk.
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (s *Service) List(ctx context.Context, order string) ([]Summary, error) {
	sorting := "word COLLATE NOCASE ASC"
	switch order {
	case "alphabetical":
	case "newest":
		sorting = "saved_at DESC, word ASC"
	case "oldest":
		sorting = "saved_at ASC, word ASC"
	default:
		return nil, errors.New("无效的排序方式")
	}
	rows, err := s.db.QueryContext(ctx, "SELECT entry FROM words ORDER BY "+sorting)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Summary, 0)
	for rows.Next() {
		var data string
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		var entry Entry
		if err = json.Unmarshal([]byte(data), &entry); err != nil {
			return nil, err
		}
		brief := ""
		if len(entry.Meanings) > 0 && len(entry.Meanings[0].Definitions) > 0 {
			brief = entry.Meanings[0].Definitions[0].Definition
		}
		result = append(result, Summary{entry.Word, entry.Phonetic, brief, entry.SavedAt})
	}
	return result, rows.Err()
}
