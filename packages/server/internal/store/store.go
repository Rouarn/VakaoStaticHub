// 包 store 是 SQLite 的唯一访问层。
//
// 连接按读写分离：Writer 串行（SetMaxOpenConns(1)，事务用 immediate
// 锁），Reader 走 query_only 连接池。所有时间在库内以 Unix 毫秒存储，
// 出库时统一转成 UTC time.Time。
//
// 错误约定：记录不存在返回 ErrNotFound，唯一约束冲突返回 ErrConflict；
// 其他错误原样透传，由 HTTP 层归一为 500。
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Store 持有读写两个连接池。业务代码只通过方法访问，不要直接
// 复用里面的 *sql.DB，否则会绕过迁移与连接数约束。
type Store struct {
	Writer *sql.DB
	Reader *sql.DB
	path   string
}

// Open 打开（必要时创建）数据库，执行内嵌迁移与短码回填，
// 然后建立只读连接池。任一阶段失败都会关闭已打开的连接。
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create database dir: %w", err)
	}
	writer, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		return nil, fmt.Errorf("open sqlite writer: %w", err)
	}
	writer.SetMaxOpenConns(1)
	writer.SetMaxIdleConns(1)
	writer.SetConnMaxLifetime(0)

	s := &Store{Writer: writer, Reader: nil, path: path}
	if err := s.migrate(context.Background()); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if err := s.ensureShortCodes(context.Background()); err != nil {
		_ = writer.Close()
		return nil, err
	}

	reader, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		_ = writer.Close()
		return nil, fmt.Errorf("open sqlite reader: %w", err)
	}
	reader.SetMaxOpenConns(4)
	reader.SetMaxIdleConns(4)
	reader.SetConnMaxLifetime(0)
	s.Reader = reader
	return s, nil
}

// dsn 构造 SQLite 连接串。读写连接只在 query_only 与事务锁策略上不同：
// 写连接用 _txlock=immediate，提前拿写锁，避免升级锁时死锁。
func dsn(path string, readonly bool) string {
	pragmas := []string{
		"_pragma=busy_timeout(5000)",
		"_pragma=journal_mode(WAL)",
		"_pragma=synchronous(NORMAL)",
		"_pragma=foreign_keys(1)",
		"_pragma=cache_size(-4000)",
		"_pragma=temp_store(memory)",
	}
	if readonly {
		pragmas = append(pragmas, "_pragma=query_only(1)")
	} else {
		pragmas = append(pragmas, "_txlock=immediate")
	}
	return "file:" + filepath.ToSlash(path) + "?" + strings.Join(pragmas, "&")
}

// Close 先关只读连接，再 checkpoint 并关闭写连接；返回第一个错误。
// checkpoint 让 WAL 内容合并回主库，避免留下体积过大的 -wal 文件。
func (s *Store) Close() error {
	var first error
	if s.Reader != nil {
		if err := s.Reader.Close(); err != nil {
			first = err
		}
	}
	if s.Writer != nil {
		_, _ = s.Writer.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
		if err := s.Writer.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// migrate 按文件名前缀顺序执行内嵌迁移，每个文件一个事务。
// 已记录的版本会跳过，因此新增迁移只需添加 SQL 文件。
func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.Writer.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(entries)
	for _, name := range entries {
		base := filepath.Base(name)
		versionText, _, _ := strings.Cut(base, "_")
		version, err := strconv.Atoi(versionText)
		if err != nil {
			return fmt.Errorf("invalid migration name %q", base)
		}
		var exists int
		if err := s.Writer.QueryRowContext(ctx,
			"SELECT COUNT(1) FROM schema_migrations WHERE version = ?", version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrationFS.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := s.Writer.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		for _, stmt := range splitSQL(string(body)) {
			if _, err := tx.ExecContext(ctx, stmt); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("migration %s: %w", base, err)
			}
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
			version, time.Now().UnixMilli()); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func splitSQL(body string) []string {
	parts := strings.Split(body, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// NowMS 返回当前 Unix 毫秒时间戳，数据库时间列统一用它。
func NowMS() int64 {
	return time.Now().UnixMilli()
}

// MS 把时间转为 Unix 毫秒；零值时间返回 0，表示「未设置」。
func MS(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// Time 把库内的 Unix 毫秒转为 UTC 时间；0 返回零值时间。
func Time(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

// NullTime 把可空毫秒列转为 nil 或 UTC 时间；nil 与 0 都视为未设置。
func NullTime(ms *int64) *time.Time {
	if ms == nil || *ms == 0 {
		return nil
	}
	t := time.UnixMilli(*ms).UTC()
	return &t
}
