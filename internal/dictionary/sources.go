package dictionary

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// SourceEntry keeps each dictionary's content independent without recursive entries.
type SourceEntry struct {
	Provider  string     `json:"provider"`
	Phonetic  string     `json:"phonetic"`
	Phonetics []Phonetic `json:"phonetics"`
	Meanings  []Meaning  `json:"meanings"`
	Source    []string   `json:"sourceUrls"`
	License   License    `json:"license"`
	Examples  []Example  `json:"examples,omitempty"`
}

func sourceOf(entry Entry) SourceEntry {
	provider := entry.Provider
	if provider == "" {
		provider = "Free Dictionary API"
	}
	return SourceEntry{provider, entry.Phonetic, entry.Phonetics, entry.Meanings, entry.Source, entry.License, entry.Examples}
}

// Cached reads only the database. An empty word means no local entry exists.
func (s *Service) Cached(ctx context.Context, input string) (Entry, error) {
	word, err := Normalize(input)
	if err != nil {
		return Entry{}, err
	}
	var stored string
	err = s.db.QueryRowContext(ctx, "SELECT entry FROM words WHERE word = ?", word).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
		return Entry{}, nil
	}
	if err != nil {
		return Entry{}, fmt.Errorf("数据库读取失败: %w", err)
	}
	var entry Entry
	if err = json.Unmarshal([]byte(stored), &entry); err != nil {
		return Entry{}, fmt.Errorf("本地词条读取失败: %w", err)
	}
	entry.Cached = true
	if len(entry.Sources) == 0 {
		entry.Sources = []SourceEntry{sourceOf(entry)}
	}
	return entry, nil
}

// LookupSource fetches only a missing source, then merges it with other saved sources.
// Network operations never hold the merge lock, so a slow source cannot block a fast one.
func (s *Service) LookupSource(ctx context.Context, input, provider string) (Entry, error) {
	word, err := Normalize(input)
	if err != nil {
		return Entry{}, err
	}
	var fetch func(context.Context, string) (Entry, error)
	switch provider {
	case "Free Dictionary API":
		fetch = s.fetchFree
	case "有道词典":
		fetch = s.fetchFallback
	default:
		return Entry{}, errors.New("未知的词典来源")
	}
	cached, err := s.Cached(ctx, word)
	if err != nil {
		return Entry{}, err
	}
	for _, item := range cached.Sources {
		if item.Provider == provider {
			return cached, nil
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	found, err := fetch(ctx, word)
	if err != nil {
		return Entry{}, err
	}
	found.Word = word
	found.Provider = provider
	found.SavedAt = time.Now().UTC().Format(time.RFC3339Nano)
	for i := range found.Phonetics {
		phone := &found.Phonetics[i]
		if strings.HasPrefix(phone.Audio, "data:") {
			phone.Audio = ""
		}
		if found.Phonetic == "" {
			found.Phonetic = phone.Text
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Reload after the request so simultaneous provider responses cannot overwrite each other.
	latest, err := s.Cached(ctx, word)
	if err != nil {
		return Entry{}, err
	}
	if latest.Word == "" {
		latest = found
		latest.Sources = []SourceEntry{sourceOf(found)}
	} else {
		exists := false
		for _, item := range latest.Sources {
			exists = exists || item.Provider == provider
		}
		if !exists {
			latest.Sources = append(latest.Sources, sourceOf(found))
		}
	}
	latest.Cached = false
	data, err := json.Marshal(latest)
	if err != nil {
		return Entry{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO words(word,entry,saved_at) VALUES(?,?,?)
		ON CONFLICT(word) DO UPDATE SET entry=excluded.entry`, word, string(data), latest.SavedAt)
	if err != nil {
		return Entry{}, fmt.Errorf("保存词典来源失败: %w", err)
	}
	return latest, nil
}
