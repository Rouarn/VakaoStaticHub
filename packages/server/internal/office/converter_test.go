package office

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestConverter(t *testing.T, maxInput int64) *Converter {
	t.Helper()
	c, err := New(Config{
		CacheDir:      t.TempDir(),
		Concurrency:   1,
		Timeout:       time.Second,
		MaxInputBytes: maxInput,
		SofficePath:   "soffice",
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new converter: %v", err)
	}
	return c
}

func TestConvertRejectsUnsupportedExtension(t *testing.T) {
	c := newTestConverter(t, 10<<20)
	path := filepath.Join(t.TempDir(), "a.txt")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Convert(context.Background(), path, info); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("want ErrUnsupported, got %v", err)
	}
}

func TestConvertRejectsOversizeInput(t *testing.T) {
	c := newTestConverter(t, 4)
	path := filepath.Join(t.TempDir(), "a.pptx")
	if err := os.WriteFile(path, []byte("larger than four bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Convert(context.Background(), path, info); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
}

func TestCacheKeyChangesWithSource(t *testing.T) {
	first := filepath.Join(t.TempDir(), "a.pptx")
	if err := os.WriteFile(first, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	key := cacheKey(first, info)
	if key == "" || len(key) != 64 {
		t.Fatalf("unexpected key %q", key)
	}
	if cacheKey(first, info) != key {
		t.Fatal("cache key should be stable for the same file state")
	}
	if err := os.WriteFile(first, []byte("one-two"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	if cacheKey(first, changed) == key {
		t.Fatal("cache key should change when size changes")
	}
}

func TestCleanupExpiresAndCaps(t *testing.T) {
	c := newTestConverter(t, 10<<20)
	now := time.Now()
	old := filepath.Join(c.root, "aa", "old.pdf")
	keep := filepath.Join(c.root, "bb", "keep.pdf")
	for _, path := range []string{old, keep} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, make([]byte, 1024), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(old, now.Add(-40*24*time.Hour), now.Add(-40*24*time.Hour)); err != nil {
		t.Fatal(err)
	}

	stats, err := c.Cleanup(CleanupOptions{Retention: 30 * 24 * time.Hour, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if stats.Expired != 1 {
		t.Fatalf("want 1 expired, got %+v", stats)
	}
	if _, err := os.Stat(old); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expired cache file should be removed")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("fresh cache file should be kept")
	}

	stats, err = c.Cleanup(CleanupOptions{MaxBytes: 1, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if stats.OverCap != 1 {
		t.Fatalf("want 1 evicted by cap, got %+v", stats)
	}
	if stats.RemainingBytes != 0 {
		t.Fatalf("want empty cache, got %d bytes", stats.RemainingBytes)
	}
}
