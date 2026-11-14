package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
)

// shortCodeLength 是内容短码的基础长度：sha256 十六进制串的前 12 位（48 位空间）。
const shortCodeLength = 12

// shortCodeStep 是撞码时短码的增长步长。
const shortCodeStep = 4

// shortCodeDigest 由「内容 sha256 + 根/分类/相对路径」派生完整摘要。
// 同一份内容出现在不同路径时会得到不同摘要，每条记录一个短码；
// 内容和路径任一变化，短码都会随之变化。
func shortCodeDigest(rootID, category, relPath, contentHash string) string {
	sum := sha256.Sum256([]byte(contentHash + "\x00" + rootID + "\x00" + category + "\x00" + relPath))
	return hex.EncodeToString(sum[:])
}

// shortCodeQuerier 覆盖 *sql.DB 与 *sql.Tx，便于在事务内做撞码检查。
type shortCodeQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// resolveShortCode 为一条记录选一个未被占用的短码。
// 先试 12 位；如果该码已被「内容或路径不同」的记录占用，则每次加 4 位重试，
// 最长到完整 64 位。同一条记录（重扫 / 原地更新）不算占用，可以沿用。
func resolveShortCode(ctx context.Context, q shortCodeQuerier, rootID, category, relPath, contentHash string) (string, error) {
	digest := shortCodeDigest(rootID, category, relPath, contentHash)
	for length := shortCodeLength; ; length += shortCodeStep {
		if length > len(digest) {
			length = len(digest)
		}
		candidate := digest[:length]
		var occupied int
		err := q.QueryRowContext(ctx,
			`SELECT 1 FROM file_entries
			 WHERE short_code = ? AND NOT (root_id = ? AND category = ? AND rel_path = ?)
			 LIMIT 1`,
			candidate, rootID, category, relPath).Scan(&occupied)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return candidate, nil
		case err != nil:
			return "", err
		case length >= len(digest):
			// 64 位全撞只可能发生在完全相同的输入上，上面的同路径分支已兜住
			return "", fmt.Errorf("短码冲突无法消解：%s/%s/%s", rootID, category, relPath)
		}
	}
}

// ensureShortCodes 为历史数据回填短码，回填完成后再建唯一索引。
// SQLite 没有内置 sha256，只能逐行在 Go 里算；唯一索引也必须等所有行都有码才能建。
func (s *Store) ensureShortCodes(ctx context.Context) error {
	var exists int
	if err := s.Writer.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM sqlite_master
		 WHERE type = 'index' AND name = 'idx_file_entries_short_code' AND sql LIKE '%UNIQUE%'`).
		Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}

	type record struct {
		id          int64
		rootID      string
		category    string
		relPath     string
		contentHash string
	}
	rows, err := s.Writer.QueryContext(ctx,
		`SELECT id, root_id, category, rel_path, COALESCE(content_hash, '') FROM file_entries ORDER BY id`)
	if err != nil {
		return err
	}
	records := make([]record, 0, 4096)
	for rows.Next() {
		var item record
		if err := rows.Scan(&item.id, &item.rootID, &item.category, &item.relPath, &item.contentHash); err != nil {
			rows.Close()
			return err
		}
		records = append(records, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	// 旧版本可能留下同名普通索引，先删掉，避免回填时被旧约束挡住。
	if _, err := s.Writer.ExecContext(ctx, `DROP INDEX IF EXISTS idx_file_entries_short_code`); err != nil {
		return err
	}

	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range records {
		code, err := resolveShortCode(ctx, tx, item.rootID, item.category, item.relPath, item.contentHash)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE file_entries SET short_code = ? WHERE id = ?`, code, item.id); err != nil {
			return err
		}
	}
	// 短码按记录唯一：同一内容散落在不同路径会得到不同的码。
	if _, err := tx.ExecContext(ctx,
		`CREATE UNIQUE INDEX idx_file_entries_short_code ON file_entries(short_code)`); err != nil {
		return err
	}
	return tx.Commit()
}
