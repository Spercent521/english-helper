// Preview serves the same frontend and service for automated browser checks.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Spercent521/english-helper/internal/dictionary"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:34115", "loopback listen address")
	db := flag.String("db", "", "optional persistent preview database")
	flag.Parse()
	if *db == "" {
		dir, err := os.MkdirTemp("", "english-helper-preview-*")
		if err != nil {
			log.Fatal(err)
		}
		defer os.RemoveAll(dir)
		*db = filepath.Join(dir, "dictionary.db")
	}
	service, err := dictionary.Open(*db)
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var input struct {
			Value  string `json:"value"`
			Accent string `json:"accent"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
			http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
			return
		}
		var result interface{}
		var err error
		switch r.URL.Path {
		case "/api/lookup":
			result, err = service.Lookup(r.Context(), input.Value)
		case "/api/list":
			result, err = service.List(r.Context(), input.Value)
		case "/api/pronounce":
			result, err = service.Pronounce(r.Context(), input.Value, input.Accent)
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(result)
	})
	mux.Handle("/", http.FileServer(http.Dir("frontend/dist")))
	server := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-done
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	log.Printf("Preview: http://%s", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Print(err)
	}
}
