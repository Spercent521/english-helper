package dictionary

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Only consume publicly returned plain dictionary fields; ignore encrypted/licensed sections.
type fallbackResponse struct {
	EC struct {
		Words []struct {
			USPhone string `json:"usphone"`
			UKPhone string `json:"ukphone"`
			Phrase  struct {
				L struct {
					I string `json:"i"`
				} `json:"l"`
			} `json:"return-phrase"`
			Translations []struct {
				Items []struct {
					L struct {
						Items []string `json:"i"`
					} `json:"l"`
				} `json:"tr"`
			} `json:"trs"`
		} `json:"word"`
	} `json:"ec"`
	Sentences struct {
		Pairs []struct {
			Sentence    string `json:"sentence"`
			Translation string `json:"sentence-translation"`
			Source      string `json:"source"`
		} `json:"sentence-pair"`
	} `json:"blng_sents_part"`
}

func (s *Service) fetchFallback(ctx context.Context, word string) (Entry, error) {
	u, err := url.Parse(s.fallbackEndpoint)
	if err != nil {
		return Entry{}, err
	}
	query := u.Query()
	query.Set("q", word)
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return Entry{}, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return Entry{}, errors.New("无法连接词典服务，请检查网络后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Entry{}, errors.New("备用词典服务暂时不可用，请稍后重试")
	}
	var data fallbackResponse
	if err = json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&data); err != nil {
		return Entry{}, errors.New("备用词典返回了无效数据")
	}
	entry := Entry{Word: word, Provider: "有道词典", Source: []string{"https://dict.youdao.com/result?word=" + url.QueryEscape(word) + "&lang=en"}}
	for _, item := range data.EC.Words {
		// Do not silently save spelling suggestions under the originally typed word.
		if !strings.EqualFold(strings.TrimSpace(item.Phrase.L.I), word) {
			continue
		}
		for _, phone := range []struct{ text, accent string }{{item.USPhone, "us"}, {item.UKPhone, "uk"}} {
			if phone.text != "" {
				entry.Phonetics = append(entry.Phonetics, Phonetic{Text: "/" + phone.text + "/", Accent: phone.accent})
			}
		}
		meaning := Meaning{PartOfSpeech: "释义"}
		for _, translation := range item.Translations {
			for _, tr := range translation.Items {
				for _, definition := range tr.L.Items {
					if strings.TrimSpace(definition) != "" {
						meaning.Definitions = append(meaning.Definitions, Definition{Definition: definition})
					}
				}
			}
		}
		if len(meaning.Definitions) > 0 {
			entry.Meanings = append(entry.Meanings, meaning)
		}
	}
	if len(entry.Meanings) == 0 {
		return Entry{}, errNotFound
	}
	for _, pair := range data.Sentences.Pairs {
		if pair.Sentence != "" {
			entry.Examples = append(entry.Examples, Example{Sentence: pair.Sentence, Translation: pair.Translation, Source: pair.Source})
		}
		if len(entry.Examples) >= 3 {
			break
		}
	}
	return entry, nil
}
