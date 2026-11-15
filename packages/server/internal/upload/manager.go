// 包 upload 负责分片上传会话的磁盘状态。每个会话
// 是配置临时目录下的一个目录，包含 meta.json 与原始
// 分片文件。请求之间不在内存中保留任何状态，因此重启不会
// 丢失已部分上传的文件。
package upload

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	// ErrInvalidSession 表示会话 id、元数据或目录状态不合法。
	ErrInvalidSession = errors.New("invalid upload session")
	// ErrInvalidChunk 表示分片序号越界或分片大小与计划不一致。
	ErrInvalidChunk = errors.New("invalid chunk")
	// ErrIncomplete 表示合并时仍有分片缺失。
	ErrIncomplete = errors.New("upload is incomplete")
)

// Session 描述一次分片上传。
type Session struct {
	ID        string    `json:"id"`
	RootID    string    `json:"rootId"`
	Category  string    `json:"category"`
	Filename  string    `json:"filename"`
	Size      int64     `json:"size"`
	ChunkSize int64     `json:"chunkSize"`
	CreatedAt time.Time `json:"createdAt"`
}

// ChunkCount 是该会话所需的分片数量。
func (s Session) ChunkCount() int {
	if s.ChunkSize <= 0 {
		return 0
	}
	count := (s.Size + s.ChunkSize - 1) / s.ChunkSize
	if count <= 0 {
		count = 1
	}
	return int(count)
}

// ExpectedChunkSize 返回单个分片的精确字节大小。
func (s Session) ExpectedChunkSize(index int) int64 {
	if index < 0 || index >= s.ChunkCount() {
		return -1
	}
	if index == s.ChunkCount()-1 {
		remaining := s.Size - int64(index)*s.ChunkSize
		return remaining
	}
	return s.ChunkSize
}

// Manager 管理磁盘上的分片会话，本身无可变状态，可并发使用。
// 会话 id 会被直接拼进路径，因此必须先通过 validID 校验。
type Manager struct {
	dir string
}

// New 以 dir 作为会话根目录。目录由 Create 按需创建，
// 构造阶段不检查其是否存在。
func New(dir string) *Manager {
	return &Manager{dir: dir}
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

// validID 限定会话 id 为 16-64 位字母数字与下划线/连字符，
// 防止通过 id 做路径穿越。
func validID(id string) bool { return idPattern.MatchString(id) }

// sessionDir 返回会话目录；调用前必须确认 id 已通过 validID。
func (m *Manager) sessionDir(id string) string {
	return filepath.Join(m.dir, id)
}

// Create 初始化会话目录并持久化元数据。
func (m *Manager) Create(session Session) (Session, error) {
	if err := m.validate(session); err != nil {
		return Session{}, err
	}
	if session.CreatedAt.IsZero() {
		session.CreatedAt = time.Now().UTC()
	}
	dir := m.sessionDir(session.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Session{}, err
	}
	body, err := json.Marshal(session)
	if err != nil {
		return Session{}, err
	}
	tmp := filepath.Join(dir, "meta.json.tmp")
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return Session{}, err
	}
	if err := os.Rename(tmp, filepath.Join(dir, "meta.json")); err != nil {
		return Session{}, err
	}
	return session, nil
}

// validate 拒绝非法 id、空文件名、非正大小、非正分片大小与
// 超过 1 万片的会话。
func (m *Manager) validate(session Session) error {
	switch {
	case !validID(session.ID):
		return ErrInvalidSession
	case strings.TrimSpace(session.Filename) == "":
		return ErrInvalidSession
	case session.Size <= 0:
		return ErrInvalidSession
	case session.ChunkSize <= 0:
		return ErrInvalidSession
	case session.ChunkCount() > 10000:
		return ErrInvalidSession
	}
	return nil
}

// Load 读取会话元数据，并返回已存在的分片序号。
func (m *Manager) Load(id string) (Session, []int, error) {
	if !validID(id) {
		return Session{}, nil, ErrInvalidSession
	}
	dir := m.sessionDir(id)
	body, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if err != nil {
		return Session{}, nil, ErrInvalidSession
	}
	var session Session
	if err := json.Unmarshal(body, &session); err != nil || session.ID != id {
		return Session{}, nil, ErrInvalidSession
	}
	return session, m.uploadedChunks(session), nil
}

// uploadedChunks 扫描会话目录，返回大小与计划一致的分片序号；
// 大小不符的分片视为未完成（可能被中断），不会被计入。
func (m *Manager) uploadedChunks(session Session) []int {
	indexes := make([]int, 0, session.ChunkCount())
	total := session.ChunkCount()
	for i := 0; i < total; i++ {
		info, err := os.Stat(m.chunkPath(session.ID, i))
		if err == nil && info.Size() == session.ExpectedChunkSize(i) {
			indexes = append(indexes, i)
		}
	}
	return indexes
}

// chunkPath 返回分片文件路径，序号补零以便按名字排序。
func (m *Manager) chunkPath(id string, index int) string {
	return filepath.Join(m.sessionDir(id), fmt.Sprintf("chunk-%05d", index))
}

// WriteChunk 存储一个分片。请求体大小必须与预期完全一致；
// 过短或过长都会被拒绝。
func (m *Manager) WriteChunk(session Session, index int, body io.Reader) error {
	expected := session.ExpectedChunkSize(index)
	if expected < 0 {
		return ErrInvalidChunk
	}
	dir := m.sessionDir(session.ID)
	if _, err := os.Stat(dir); err != nil {
		return ErrInvalidSession
	}
	tmp, err := os.CreateTemp(dir, ".chunk-*")
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(tmp, io.LimitReader(body, expected+1))
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmp.Name())
		return ErrInvalidChunk
	}
	if written != expected {
		_ = os.Remove(tmp.Name())
		return ErrInvalidChunk
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), m.chunkPath(session.ID, index)); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// Merge 按顺序将所有分片流式写入 w。调用方负责
// 计算哈希并校验总大小。
func (m *Manager) Merge(session Session, w io.Writer) (int64, error) {
	var total int64
	for i := 0; i < session.ChunkCount(); i++ {
		expected := session.ExpectedChunkSize(i)
		f, err := os.Open(m.chunkPath(session.ID, i))
		if err != nil {
			return total, ErrIncomplete
		}
		n, err := io.Copy(w, io.LimitReader(f, expected))
		f.Close()
		if err != nil {
			return total, err
		}
		if n != expected {
			return total, ErrIncomplete
		}
		total += n
	}
	if total != session.Size {
		return total, ErrIncomplete
	}
	return total, nil
}

// ErrNotFound 表示会话目录不存在，供删除与查询统一返回。
var ErrNotFound = errors.New("upload session not found")

// Remove 删除会话及其所有分片。
func (m *Manager) Remove(id string) error {
	if !validID(id) {
		return ErrNotFound
	}
	dir := m.sessionDir(id)
	if _, err := os.Stat(dir); err != nil {
		return ErrNotFound
	}
	return os.RemoveAll(dir)
}

// Cleanup 删除超过 maxAge 的会话，并返回删除数量。
func (m *Manager) Cleanup(maxAge time.Duration) int {
	entries, err := os.ReadDir(m.dir)
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			ids = append(ids, entry.Name())
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		dir := m.sessionDir(id)
		info, err := os.Stat(dir)
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.RemoveAll(dir); err == nil {
			removed++
		}
	}
	return removed
}
