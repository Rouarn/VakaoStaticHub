package httpapi

import (
	"context"
	"errors"
	"math/rand/v2"
	"sync"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

// photoPoolLimit 限制同时缓存的池数量。key 由请求参数构成，
// 但只有命中已索引图片的组合才会真正建立池；该上限用于兜住
// 分类反复增删的长期运行场景，超出后按最近最少使用淘汰。
const photoPoolLimit = 256

// photoPools 为每个随机图范围维护一个已打乱队列，逐张发出，
// 发完重新洗牌；同时避免跨轮时刚发过的那张立刻又出现。
// 状态只保存在内存中，重启后从头开始。
type photoPools struct {
	mu    sync.Mutex
	clock uint64
	pools map[string]*photoPool
}

type photoPool struct {
	all    []int64 // 最近一次看到的池成员，按 id 升序
	queue  []int64 // 尚未发出的 id，顺序已打乱
	lastID int64   // 上一次发出的 id
	used   uint64  // 最近一次访问的序号，用于淘汰
}

func newPhotoPools() *photoPools {
	return &photoPools{pools: make(map[string]*photoPool)}
}

// Next 按轮转顺序返回池中的下一张图片。
// 每次请求都会重新读取池成员，索引增删后下一次取图即可感知。
func (p *photoPools) Next(ctx context.Context, st *store.Store, rootID, category string) (model.FileEntry, error) {
	for attempt := 0; attempt < 3; attempt++ {
		id, err := p.nextID(ctx, st, rootID, category)
		if err != nil {
			return model.FileEntry{}, err
		}
		entry, err := st.FileByID(ctx, id)
		if err == nil {
			return entry, nil
		}
		if !errors.Is(err, store.ErrNotFound) {
			return model.FileEntry{}, err
		}
		// 索引在两次查询之间发生了变化，丢弃旧队列后重试。
		p.drop(rootID, category)
	}
	return model.FileEntry{}, store.ErrNotFound
}

func (p *photoPools) nextID(ctx context.Context, st *store.Store, rootID, category string) (int64, error) {
	ids, err := st.ImageIDs(ctx, rootID, category)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		// 该范围已经没有任何图片，顺手丢掉旧队列，避免长期占位。
		p.drop(rootID, category)
		return 0, store.ErrNotFound
	}

	key := rootID + "\x00" + category
	p.mu.Lock()
	defer p.mu.Unlock()

	pool := p.pools[key]
	if pool == nil {
		if len(p.pools) >= photoPoolLimit {
			p.evictLRULocked()
		}
		pool = &photoPool{}
		p.pools[key] = pool
	}
	p.clock++
	pool.used = p.clock
	if !sameIDs(pool.all, ids) {
		pool.all = ids
		pool.queue = shuffleIDs(ids, pool.lastID)
	}
	if len(pool.queue) == 0 {
		pool.queue = shuffleIDs(pool.all, pool.lastID)
	}
	id := pool.queue[0]
	pool.queue = pool.queue[1:]
	pool.lastID = id
	return id, nil
}

func (p *photoPools) drop(rootID, category string) {
	key := rootID + "\x00" + category
	p.mu.Lock()
	delete(p.pools, key)
	p.mu.Unlock()
}

// evictLRULocked 淘汰最久未使用的池；调用方需持有 p.mu。
func (p *photoPools) evictLRULocked() {
	var (
		oldestKey  string
		oldestUsed uint64
		found      bool
	)
	for key, pool := range p.pools {
		if !found || pool.used < oldestUsed {
			oldestKey, oldestUsed, found = key, pool.used, true
		}
	}
	if found {
		delete(p.pools, oldestKey)
	}
}

func sameIDs(left, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

// shuffleIDs 返回打乱后的副本。若首张恰好是上一轮最后发出的
// 图片，则与随机位置交换，避免跨轮连续重复；单元素池保持原样。
func shuffleIDs(ids []int64, avoidFirst int64) []int64 {
	out := make([]int64, len(ids))
	copy(out, ids)
	rand.Shuffle(len(out), func(i, j int) {
		out[i], out[j] = out[j], out[i]
	})
	if len(out) > 1 && out[0] == avoidFirst {
		swap := rand.IntN(len(out)-1) + 1
		out[0], out[swap] = out[swap], out[0]
	}
	return out
}
