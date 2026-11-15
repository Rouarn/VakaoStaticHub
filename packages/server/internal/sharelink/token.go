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

var ErrInvalidToken = errors.New("invalid share access token")

type Claims struct {
	ShareID int64  `json:"sid"`
	Token   string `json:"tok"`
	Exp     int64  `json:"exp"`
}

type Manager struct {
	secret []byte
	ttl    time.Duration
}

func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

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
