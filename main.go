package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Spercent521/english-helper/internal/dictionary"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

type App struct {
	ctx     context.Context
	service *dictionary.Service
}

func (a *App) Lookup(word string) (dictionary.Entry, error) { return a.service.Lookup(a.ctx, word) }
func (a *App) Cached(word string) (dictionary.Entry, error) { return a.service.Cached(a.ctx, word) }
func (a *App) LookupSource(word, provider string) (dictionary.Entry, error) {
	return a.service.LookupSource(a.ctx, word, provider)
}
func (a *App) List(order string) ([]dictionary.Summary, error) { return a.service.List(a.ctx, order) }
func (a *App) Pronounce(word, accent string) (string, error) {
	return a.service.Pronounce(a.ctx, word, accent)
}

func main() {
	config, err := os.UserConfigDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	service, err := dictionary.Open(filepath.Join(config, "English Helper", "dictionary.db"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer service.Close()
	app := &App{service: service}
	err = wails.Run(&options.App{
		Title: "English Helper", Width: 1120, Height: 780, MinWidth: 760, MinHeight: 600,
		BackgroundColour: &options.RGBA{R: 247, G: 249, B: 250, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        func(ctx context.Context) { app.ctx = ctx },
		Bind:             []interface{}{app},
		Mac:              &mac.Options{TitleBar: mac.TitleBarDefault()},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
