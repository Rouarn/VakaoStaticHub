// 包 sharelink 管理分享文件的两种访问凭证：
//
//   - Manager：密码分享解锁后发放的短期会话令牌（token.go）。地址每次访问都变，
//     但无法被转发后绕过密码；
//   - Signer：公开分享文件地址的稳定签名（sign.go）。同一版本的同一文件
//     永远得到同一地址，CDN 可以真正复用缓存。
//
// 两者都使用 HMAC 且绑定分享记录，无法被重放到其他链接。
package sharelink

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

// ErrInvalidToken 是会话令牌校验失败的统一错误。
var ErrInvalidToken = errors.New("invalid share access token")

// Claims 是会话令牌载荷：绑定分享记录 id 与公开 token，并自带过期时间。
type Claims struct {
	ShareID int64  `json:"sid"`
	Token   string `json:"tok"`
	Exp     int64  `json:"exp"`
}

// Manager 签发与校验会话令牌；密钥由 config 保证长度。
type Manager struct {
	secret []byte
	ttl    time.Duration
}

// NewManager 构造会话令牌管理器。ttl 决定解锁后地址的有效时长，
// 目前由调用方设为 30 分钟。
func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

// Issue 为某条分享签发短期访问令牌，返回令牌与过期时间。
// 令牌只承载分享 id 与 token，不包含用户身份。
func (m *Manager) Issue(shareID int64, token string) (string, time.Time, error) {
	expires := time.Now().Add(m.ttl)
	payload, err := json.Marshal(Claims{ShareID: shareID, Token: token, Exp: expires.Unix()})
	if err != nil {
		return "", time.Time{}, err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(body))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return body + "." + signature, expires, nil
}

// Parse 校验签名与过期时间；任何失败都返回 ErrInvalidToken，
// 调用方只需按「令牌无效或已过期」处理。
func (m *Manager) Parse(value string) (Claims, error) {
	var claims Claims
	body, signature, ok := cutToken(value)
	if !ok {
		return claims, ErrInvalidToken
	}
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(body))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return claims, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return claims, ErrInvalidToken
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return claims, ErrInvalidToken
	}
	if claims.ShareID <= 0 || claims.Token == "" || claims.Exp <= time.Now().Unix() {
		return claims, ErrInvalidToken
	}
	return claims, nil
}

// cutToken 在第一个点处切分「载荷.签名」；任一侧为空都视为无效。
func cutToken(value string) (body, signature string, ok bool) {
	for i := 0; i < len(value); i++ {
		if value[i] == '.' {
			if i == 0 || i == len(value)-1 {
				return "", "", false
			}
			return value[:i], value[i+1:], true
		}
	}
	return "", "", false
}
