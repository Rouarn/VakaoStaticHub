package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"vakao-static-hub/server/internal/model"
)

func TestDeleteExpiredShares(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "shares.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	ctx := context.Background()
	now := time.Now()
	past := now.Add(-time.Hour)
	future := now.Add(24 * time.Hour)
	zero := 0
	one := 1

	create := func(token string, expires *time.Time, maxAccesses *int) ShareRecord {
		t.Helper()
		record, err := st.CreateShare(ctx, ShareRecord{ShareLink: model.ShareLink{
			Token:       token,
			RootID:      "default",
			Category:    "cat",
			FilePaths:   []string{"a.jpg"},
			Enabled:     true,
			ExpiresAt:   expires,
			MaxAccesses: maxAccesses,
		}})
		if err != nil {
			t.Fatalf("create %s: %v", token, err)
		}
		return record
	}

	expired := create("expired", &past, nil)
	exhausted := create("exhausted", nil, &one)
	unlimited := create("unlimited", nil, &zero)
	active := create("active", &future, nil)

	for _, record := range []ShareRecord{expired, exhausted, unlimited, active} {
		if err := st.InsertShareAccessLog(ctx, record.ID, "127.0.0.1", "test-agent", true); err != nil {
			t.Fatalf("insert log: %v", err)
		}
	}
	if err := st.IncrementShareAccess(ctx, exhausted.ID); err != nil {
		t.Fatalf("increment access: %v", err)
	}

	deleted, err := st.DeleteExpiredShares(ctx, now.UnixMilli())
	if err != nil {
		t.Fatalf("delete expired shares: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}

	for _, token := range []string{"expired", "exhausted"} {
		if _, err := st.ShareByToken(ctx, token); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s still exists, err = %v", token, err)
		}
	}
	if got := countShareLogs(t, st, expired.ID); got != 0 {
		t.Fatalf("expired share logs = %d, want 0 (cascade)", got)
	}
	if got := countShareLogs(t, st, exhausted.ID); got != 0 {
		t.Fatalf("exhausted share logs = %d, want 0 (cascade)", got)
	}

	for _, token := range []string{"unlimited", "active"} {
		if _, err := st.ShareByToken(ctx, token); err != nil {
			t.Fatalf("%s should be kept: %v", token, err)
		}
	}
	if got := countShareLogs(t, st, unlimited.ID); got != 1 {
		t.Fatalf("unlimited share logs = %d, want 1", got)
	}
	if got := countShareLogs(t, st, active.ID); got != 1 {
		t.Fatalf("active share logs = %d, want 1", got)
	}

	// 幂等：再次执行不应删除任何记录。
	again, err := st.DeleteExpiredShares(ctx, now.UnixMilli())
	if err != nil {
		t.Fatalf("second cleanup: %v", err)
	}
	if again != 0 {
		t.Fatalf("second cleanup deleted %d rows", again)
	}
}

func countShareLogs(t *testing.T, st *Store, shareID int64) int {
	t.Helper()
	var count int
	if err := st.Reader.QueryRow(
		"SELECT COUNT(1) FROM share_access_logs WHERE share_id = ?", shareID).Scan(&count); err != nil {
		t.Fatalf("count logs: %v", err)
	}
	return count
}
