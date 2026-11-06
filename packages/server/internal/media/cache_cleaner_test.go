package media

import (
	"context"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeCacheFile(t *testing.T, dir, name string, size int, mod time.Time) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatalf("chtimes %s: %v", name, err)
	}
	return path
}

func TestThumbnailCleanupRetention(t *testing.T) {
	cacheDir := t.TempDir()
	thumbnails := NewThumbnailer(cacheDir, 60_000_000, 4096, 1)
	dir := filepath.Join(cacheDir, "thumbs", "ab")
	now := time.Now()

	fresh := writeCacheFile(t, dir, "fresh.jpg", 8, now.Add(-2*time.Hour))
	expired := writeCacheFile(t, dir, "expired.jpg", 8, now.Add(-40*24*time.Hour))
	staleTemp := writeCacheFile(t, dir, ".tmp-stale", 8, now.Add(-2*time.Hour))
	activeTemp := writeCacheFile(t, dir, ".tmp-active", 8, now.Add(-time.Minute))

	stats, err := thumbnails.Cleanup(CleanupOptions{Retention: 30 * 24 * time.Hour, Now: now})
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if stats.Expired != 1 || stats.Temp != 1 {
		t.Fatalf("stats = %+v, want expired=1 temp=1", stats)
	}
	assertMissing(t, expired)
	assertMissing(t, staleTemp)
	assertExists(t, fresh)
	assertExists(t, activeTemp)

	// 幂等：再次执行不应删除任何内容。
	again, err := thumbnails.Cleanup(CleanupOptions{Retention: 30 * 24 * time.Hour, Now: now})
	if err != nil {
		t.Fatalf("second cleanup: %v", err)
	}
	if again.Expired != 0 || again.Temp != 0 || again.OverCap != 0 || again.FreedBytes != 0 {
		t.Fatalf("second cleanup not idempotent: %+v", again)
	}
}

func TestThumbnailCleanupCapacity(t *testing.T) {
	cacheDir := t.TempDir()
	thumbnails := NewThumbnailer(cacheDir, 60_000_000, 4096, 1)
	dir := filepath.Join(cacheDir, "thumbs", "cd")
	now := time.Now()

	oldest := writeCacheFile(t, dir, "oldest.jpg", 10, now.Add(-3*time.Hour))
	middle := writeCacheFile(t, dir, "middle.jpg", 10, now.Add(-2*time.Hour))
	newest := writeCacheFile(t, dir, "newest.jpg", 10, now.Add(-time.Hour))

	stats, err := thumbnails.Cleanup(CleanupOptions{MaxBytes: 15, Now: now})
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if stats.OverCap != 2 || stats.RemainingBytes != 10 {
		t.Fatalf("stats = %+v, want overCap=2 remaining=10", stats)
	}
	assertMissing(t, oldest)
	assertMissing(t, middle)
	assertExists(t, newest)

	again, err := thumbnails.Cleanup(CleanupOptions{MaxBytes: 15, Now: now})
	if err != nil {
		t.Fatalf("second cleanup: %v", err)
	}
	if again.OverCap != 0 {
		t.Fatalf("second cleanup removed %d extra files", again.OverCap)
	}
}

func TestThumbnailHitTouchesAccessTime(t *testing.T) {
	cacheDir := t.TempDir()
	thumbnails := NewThumbnailer(filepath.Join(cacheDir, "cache"), 60_000_000, 4096, 1)
	source := filepath.Join(cacheDir, "source.png")
	writeTestPNG(t, source)
	request := Request{SourcePath: source, CacheKey: "root/cat/source.png", Width: 32, Height: 32, Format: "jpeg"}

	first, err := thumbnails.Get(context.Background(), request)
	if err != nil {
		t.Fatalf("first get: %v", err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(first.Path, old, old); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	if _, err := thumbnails.Get(context.Background(), request); err != nil {
		t.Fatalf("cached get: %v", err)
	}
	info, err := os.Stat(first.Path)
	if err != nil {
		t.Fatalf("stat cached file: %v", err)
	}
	if !info.ModTime().After(old) {
		t.Fatalf("cached hit did not touch access time: %v", info.ModTime())
	}
}

func writeTestPNG(t *testing.T, path string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	defer file.Close()
	if err := png.Encode(file, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatalf("encode source: %v", err)
	}
}

func assertExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected %s to exist: %v", filepath.Base(path), err)
	}
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, stat err = %v", filepath.Base(path), err)
	}
}
