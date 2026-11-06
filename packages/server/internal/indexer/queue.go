package indexer

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"vakao-static-hub/server/internal/store"
)

// IndexState 根目录索引任务的状态。
type IndexState string

const (
	IndexStateIdle    IndexState = "idle"
	IndexStateRunning IndexState = "running"
	IndexStateDone    IndexState = "done"
	IndexStateFailed  IndexState = "failed"
)

// RootStatus 单个根目录的索引状态。只保存在内存中，进程重启后回到 idle，
// 由启动扫描重新产生。
type RootStatus struct {
	RootID       string     `json:"rootId"`
	State        IndexState `json:"state"`
	ScannedFiles int        `json:"scannedFiles"`
	IndexedFiles int        `json:"indexedFiles"`
	CurrentDir   string     `json:"currentDir"`
	StartedAt    int64      `json:"startedAt"`
	Error        string     `json:"error"`
}

// Queue 单 worker 串行执行根目录扫描任务；同一根目录重复入队会被合并。
type Queue struct {
	indexer *Indexer
	store   *store.Store
	logger  *slog.Logger

	ctx context.Context

	mu       sync.Mutex
	statuses map[string]*RootStatus
	pending  []string
	queued   map[string]struct{}
	wake     chan struct{}
}

func NewQueue(ix *Indexer, st *store.Store, logger *slog.Logger) *Queue {
	return &Queue{
		indexer:  ix,
		store:    st,
		logger:   logger,
		statuses: make(map[string]*RootStatus),
		queued:   make(map[string]struct{}),
		wake:     make(chan struct{}, 1),
	}
}

// Start 启动 worker；ctx 取消时停止。入队可以早于 Start，任务会等到 worker
// 启动后再执行。
func (q *Queue) Start(ctx context.Context) {
	q.ctx = ctx
	go q.loop()
}

// Enqueue 把根目录加入扫描队列；已在排队或正在扫描时返回 false。
func (q *Queue) Enqueue(rootID string) bool {
	if rootID == "" {
		return false
	}
	q.mu.Lock()
	if _, ok := q.queued[rootID]; ok {
		q.mu.Unlock()
		return false
	}
	if st, ok := q.statuses[rootID]; ok && st.State == IndexStateRunning {
		q.mu.Unlock()
		return false
	}
	q.queued[rootID] = struct{}{}
	q.pending = append(q.pending, rootID)
	q.mu.Unlock()

	select {
	case q.wake <- struct{}{}:
	default:
	}
	return true
}

// EnqueueAll 批量入队，返回本次真正排上队的根目录 id。
func (q *Queue) EnqueueAll(rootIDs []string) []string {
	queuedIDs := make([]string, 0, len(rootIDs))
	for _, id := range rootIDs {
		if q.Enqueue(id) {
			queuedIDs = append(queuedIDs, id)
		}
	}
	return queuedIDs
}

// Snapshot 按给定顺序返回状态；没有扫描记录的根目录视为 idle。
func (q *Queue) Snapshot(rootIDs []string) []RootStatus {
	q.mu.Lock()
	defer q.mu.Unlock()

	out := make([]RootStatus, 0, len(rootIDs))
	for _, id := range rootIDs {
		if st, ok := q.statuses[id]; ok {
			out = append(out, *st)
			continue
		}
		out = append(out, RootStatus{RootID: id, State: IndexStateIdle})
	}
	return out
}

func (q *Queue) loop() {
	for {
		select {
		case <-q.ctx.Done():
			return
		case <-q.wake:
		}
		for {
			rootID, ok := q.take()
			if !ok {
				break
			}
			q.run(rootID)
		}
	}
}

func (q *Queue) take() (string, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.pending) == 0 {
		return "", false
	}
	rootID := q.pending[0]
	q.pending = q.pending[1:]
	delete(q.queued, rootID)
	return rootID, true
}

func (q *Queue) run(rootID string) {
	started := time.Now()
	root, err := q.store.RootByID(q.ctx, rootID)
	if err != nil {
		q.finish(rootID, IndexStateFailed, 0, 0, "", started, err)
		return
	}

	q.mu.Lock()
	q.statuses[rootID] = &RootStatus{
		RootID:    rootID,
		State:     IndexStateRunning,
		StartedAt: started.UnixMilli(),
	}
	q.mu.Unlock()

	indexed, removed, err := q.indexer.ScanRootWithProgress(q.ctx, *root,
		func(scanned, indexed int, currentDir string) {
			q.mu.Lock()
			if st := q.statuses[rootID]; st != nil {
				st.ScannedFiles = scanned
				if indexed > st.IndexedFiles {
					st.IndexedFiles = indexed
				}
				st.CurrentDir = currentDir
			}
			q.mu.Unlock()
		},
	)
	if err != nil {
		q.finish(rootID, IndexStateFailed, 0, 0, "", started, err)
		return
	}
	q.finish(rootID, IndexStateDone, 0, indexed, "", started, nil)

	q.logger.Info("root index finished",
		"rootId", rootID,
		"indexed", indexed,
		"removed", removed,
		"durationMs", time.Since(started).Milliseconds(),
	)
}

// finish 收尾状态。scanned/indexed 为 0 时保留回调累计的进度。
func (q *Queue) finish(rootID string, state IndexState, scanned, indexed int, currentDir string, started time.Time, err error) {
	q.mu.Lock()
	st := q.statuses[rootID]
	if st == nil {
		st = &RootStatus{RootID: rootID}
		q.statuses[rootID] = st
	}
	st.State = state
	if scanned > 0 {
		st.ScannedFiles = scanned
	}
	if indexed > 0 {
		st.IndexedFiles = indexed
	}
	st.CurrentDir = currentDir
	st.StartedAt = started.UnixMilli()
	if err != nil {
		st.Error = err.Error()
	} else {
		st.Error = ""
	}
	q.mu.Unlock()

	if err != nil {
		q.logger.Error("root index failed",
			"rootId", rootID,
			"error", err,
			"durationMs", time.Since(started).Milliseconds(),
		)
	}
}
