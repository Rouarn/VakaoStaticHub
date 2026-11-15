// Package office 用 LibreOffice 把前端无法渲染的文档转成 PDF，
// 交给现有 PDF 预览直接复用。
//
// 只处理 pptx/ppt/doc 与 docx 的渲染失败兜底；表格（xlsx/xls/csv）
// 刻意不在这里转换：SheetJS 在浏览器里更省资源，而服务端转换
// 20 万行 xlsx 需要约 1GB 内存、近百秒并产出数百 MB PDF。
package office

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	// ErrUnsupported 表示扩展名不在服务端转换范围。
	ErrUnsupported = errors.New("office: unsupported format")
	// ErrTooLarge 表示文件超过单文件转换上限。
	ErrTooLarge = errors.New("office: file too large")
	// ErrBusy 表示等待转换队列超时。
	ErrBusy = errors.New("office: conversion queue busy")
)

// convertibleExts 是允许服务端转 PDF 的扩展名。
var convertibleExts = map[string]bool{
	"pptx": true,
	"ppt":  true,
	"doc":  true,
	"docx": true,
}

// converterVersion 参与缓存键。转换命令或实现变化时递增，
// 旧缓存会自然失效。
const converterVersion = "1"

// queueWait 是排队等待上限：超过后返回 ErrBusy 而不是无限挂起请求。
const queueWait = 60 * time.Second

// Config 是转换器运行参数。
type Config struct {
	// CacheDir 是转换缓存根目录（同时存放转换任务目录与 soffice 用户配置）。
	// 它落在系统临时目录，系统可随时回收，回收后按需重新转换。
	CacheDir      string
	Concurrency   int
	Timeout       time.Duration
	MaxInputBytes int64
	SofficePath   string
}

// Result 是转换后的缓存文件。
type Result struct {
	Path string
	ETag string
}

// flight 代表一次进行中的转换：后来者等待 done 而不重复启动 soffice。
// res/err 在关闭 done 之前写入，因此等待方读取时无需额外加锁。
type flight struct {
	done chan struct{}
	res  Result
	err  error
}

// Converter 负责排队、去重、调用 soffice 与维护缓存。
type Converter struct {
	cfg  Config
	log  *slog.Logger
	root string
	// slots 里放的是 worker 编号：每次转换独占一个编号，
	// 对应一个固定的 LibreOffice 用户配置目录（免去重复初始化）。
	slots chan int

	mu       sync.Mutex
	inflight map[string]*flight
}

// New 创建转换器并准备缓存目录。缓存目录与 LibreOffice 用户配置都在
// 系统临时目录下，进程重启或系统回收后按需重建。
func New(cfg Config, log *slog.Logger) (*Converter, error) {
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 1
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 90 * time.Second
	}
	if cfg.SofficePath == "" {
		cfg.SofficePath = "soffice"
	}
	root := cfg.CacheDir
	if err := os.MkdirAll(filepath.Join(root, "tmp"), 0o755); err != nil {
		return nil, fmt.Errorf("create office cache dir: %w", err)
	}
	c := &Converter{
		cfg:      cfg,
		log:      log,
		root:     root,
		slots:    make(chan int, cfg.Concurrency),
		inflight: make(map[string]*flight),
	}
	for i := 0; i < cfg.Concurrency; i++ {
		profile := filepath.Join(root, "profiles", fmt.Sprintf("worker-%d", i))
		if err := os.MkdirAll(profile, 0o755); err != nil {
			return nil, fmt.Errorf("create soffice profile: %w", err)
		}
		c.slots <- i
	}
	return c, nil
}

// Convert 返回源文件对应的 PDF 缓存路径，必要时先转换。
func (c *Converter) Convert(ctx context.Context, src string, info os.FileInfo) (Result, error) {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(src)), ".")
	if !convertibleExts[ext] {
		return Result{}, ErrUnsupported
	}
	if info.Size() > c.cfg.MaxInputBytes {
		return Result{}, ErrTooLarge
	}

	key := cacheKey(src, info)
	if res, ok := c.lookup(key); ok {
		return res, nil
	}

	// 同一文件并发命中时只跑一次，其余请求等结果。
	c.mu.Lock()
	if f, running := c.inflight[key]; running {
		c.mu.Unlock()
		select {
		case <-f.done:
			return f.res, f.err
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	}
	f := &flight{done: make(chan struct{})}
	c.inflight[key] = f
	c.mu.Unlock()

	f.res, f.err = c.run(ctx, src, key)

	c.mu.Lock()
	delete(c.inflight, key)
	c.mu.Unlock()
	close(f.done)
	return f.res, f.err
}

// lookup 命中已存在的缓存文件时直接返回；空文件视为未命中，
// 以便上次转换中断后能重试。
func (c *Converter) lookup(key string) (Result, bool) {
	path := c.cachePath(key)
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() == 0 {
		return Result{}, false
	}
	return Result{Path: path, ETag: `"` + key + `"`}, true
}

// cachePath 用缓存键前两位做子目录，避免单目录堆积过多文件。
func (c *Converter) cachePath(key string) string {
	return filepath.Join(c.root, key[:2], key+".pdf")
}

// run 执行一次真实转换：排队等待空闲 worker，超时返回 ErrBusy。
// 调用方已保证同一缓存键只有一个 run 在跑。
func (c *Converter) run(ctx context.Context, src, key string) (Result, error) {
	waitCtx, cancelWait := context.WithTimeout(ctx, queueWait)
	defer cancelWait()

	var slot int
	select {
	case slot = <-c.slots:
		defer func() { c.slots <- slot }()
	case <-waitCtx.Done():
		if ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		return Result{}, ErrBusy
	}

	jobDir, err := os.MkdirTemp(filepath.Join(c.root, "tmp"), "job-")
	if err != nil {
		return Result{}, fmt.Errorf("create job dir: %w", err)
	}
	defer os.RemoveAll(jobDir)

	runCtx, cancelRun := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancelRun()

	profile := filepath.Join(c.root, "profiles", fmt.Sprintf("worker-%d", slot))
	cmd := exec.CommandContext(runCtx, c.cfg.SofficePath,
		"--headless",
		"--norestore",
		"--nolockcheck",
		"--nodefault",
		"--nofirststartwizard",
		"-env:UserInstallation=file://"+profile,
		"--convert-to", "pdf",
		"--outdir", jobDir,
		src,
	)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Result{}, fmt.Errorf("soffice stderr: %w", err)
	}
	start := time.Now()
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("soffice 不可用（%s）：%w", c.cfg.SofficePath, err)
	}
	// 只保留尾部输出用于排错，避免异常文档刷屏。
	tail, _ := io.ReadAll(io.LimitReader(stderr, 8<<10))
	waitErr := cmd.Wait()
	if runCtx.Err() != nil {
		return Result{}, fmt.Errorf("soffice 转换超时（%s）", c.cfg.Timeout)
	}
	if waitErr != nil {
		return Result{}, fmt.Errorf("soffice 转换失败：%w：%s", waitErr, strings.TrimSpace(string(tail)))
	}

	out, err := findPDF(jobDir)
	if err != nil {
		return Result{}, err
	}
	dest := c.cachePath(key)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return Result{}, fmt.Errorf("create cache shard: %w", err)
	}
	if err := os.Rename(out, dest); err != nil {
		return Result{}, fmt.Errorf("move converted pdf: %w", err)
	}
	c.log.Info("office document converted",
		"source", filepath.Base(src),
		"durationMs", time.Since(start).Milliseconds(),
		"bytes", fileSize(dest),
	)
	return Result{Path: dest, ETag: `"` + key + `"`}, nil
}

// findPDF 在输出目录里找唯一的 PDF；LibreOffice 按源文件基名命名，
// 这里不猜文件名，只校验确实产出了一个 PDF。
func findPDF(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", fmt.Errorf("read job dir: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".pdf") {
			continue
		}
		return filepath.Join(dir, entry.Name()), nil
	}
	return "", errors.New("soffice 未产出 PDF")
}

// cacheKey 由源文件绝对路径、大小与修改时间共同决定：
// 文件内容一变键就变，不会命中旧缓存。
func cacheKey(src string, info os.FileInfo) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d|%d",
		converterVersion, src, info.Size(), info.ModTime().UnixNano())))
	return hex.EncodeToString(sum[:])
}

// fileSize 返回文件字节数；不可读时返回 0（用于日志与上限判断）。
func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}
