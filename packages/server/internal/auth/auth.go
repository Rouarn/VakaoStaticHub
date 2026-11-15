// 包 auth 负责两件事：密码哈希与登录令牌。
//
// 密码使用 scrypt 加随机盐，存储格式自带算法前缀，因此将来换算法时
// 可以按记录逐条迁移；校验使用常量时间比较，避免时序侧信道。
//
// 令牌是只实现 HS256 的 JWT 子集，不引入第三方库：本服务只有一个
// 签发方与一个校验方，不需要算法协商。令牌是无状态的，改密后旧令牌
// 依靠 users.updated_at 与 claims.IatMS 的比较失效，无需服务端黑名单。
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

const (
	scryptN = 16384
	scryptR = 8
	scryptP = 1
	keyLen  = 64
)

// ErrInvalidToken 是令牌任何环节校验失败的统一错误。调用方不应
// 区分「格式错」「签名错」「已过期」，以免向客户端泄露细节。
var ErrInvalidToken = errors.New("invalid token")

// HashPassword 用随机盐派生 scrypt 密钥，返回 `scrypt$salt$key`
// （salt 与 key 均为十六进制）供直接入库。scrypt 参数是固定的，
// 校验时按存储串中的 key 长度重新派生，因此改参数只影响新密码。
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, keyLen)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("scrypt$%s$%s", hex.EncodeToString(salt), hex.EncodeToString(derived)), nil
}

// VerifyPassword 校验明文密码与存储串是否匹配，比较过程为常量时间。
// stored 为空、格式不识别或解码失败都返回 false；调用方无需区分原因，
// 统一按「用户名或密码错误」响应即可。
func VerifyPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" {
		return false
	}
	salt, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(parts[2])
	if err != nil || len(expected) == 0 {
		return false
	}
	derived, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, len(expected))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(expected, derived) == 1
}

// Claims 是令牌载荷。Sub 是用户主键；Iat 为签发秒数，IatMS 为签发
// 毫秒数（仅用于与用户记录的 updatedAt 比较）；Exp 为过期秒数。
type Claims struct {
	Sub      int64  `json:"sub"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Iat      int64  `json:"iat"`
	IatMS    int64  `json:"iatMs"`
	Exp      int64  `json:"exp"`
}

// Manager 负责签发与解析登录令牌。secret 由 config 在启动时保证长度，
// ttl 同时决定 claims.Exp 与响应里的过期时间。
type Manager struct {
	secret []byte
	ttl    time.Duration
}

// NewManager 使用给定密钥与有效期构造令牌管理器。secret 为空会让
// 所有令牌都能被伪造，因此必须由 config 提前校验。
func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

// TTL 返回令牌有效期，供登录响应与前端本地过期判断复用。
func (m *Manager) TTL() time.Duration { return m.ttl }

// Issue 签发一个 HS256 JWT，返回令牌与过期时间。令牌不落库；
// 角色随 claims 走，权限判定仍以数据库记录为准。
func (m *Manager) Issue(userID int64, username, role string) (string, time.Time, error) {
	now := time.Now()
	claims := Claims{
		Sub:      userID,
		Username: username,
		Role:     role,
		Iat:      now.Unix(),
		IatMS:    now.UnixMilli(),
		Exp:      now.Add(m.ttl).Unix(),
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", time.Time{}, err
	}
	body := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return body + "." + sig, time.Unix(claims.Exp, 0), nil
}

// Parse 校验令牌的算法、签名与时间窗，通过后返回 claims。
// 任何失败都返回 ErrInvalidToken；签发时间允许 60 秒时钟偏移，
// 载荷缺少 Sub/IatMS 的令牌一律视为无效。
func (m *Manager) Parse(token string) (Claims, error) {
	var claims Claims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims, ErrInvalidToken
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return claims, ErrInvalidToken
	}
	var header struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Alg != "HS256" {
		return claims, ErrInvalidToken
	}
	body := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(body))
	expected := mac.Sum(nil)
	actual, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(expected, actual) {
		return claims, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims, ErrInvalidToken
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return claims, ErrInvalidToken
	}
	now := time.Now().Unix()
	if claims.Sub <= 0 || claims.Exp <= now || claims.Iat > now+60 || claims.IatMS <= 0 {
		return claims, ErrInvalidToken
	}
	return claims, nil
}

// TokenFromHeader 解析 `Authorization: Bearer <token>`，前缀大小写
// 不敏感；缺失或格式不符返回 ErrInvalidToken。
func (m *Manager) TokenFromHeader(value string) (Claims, error) {
	const prefix = "Bearer "
	if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return Claims{}, ErrInvalidToken
	}
	return m.Parse(strings.TrimSpace(value[len(prefix):]))
}

// ParseUserID 把路径或查询字符串里的用户 id 转成 int64。
// 它只做类型转换，不校验范围，调用方需自行拒绝非正数。
func ParseUserID(value string) (int64, error) {
	return strconv.ParseInt(value, 10, 64)
}
