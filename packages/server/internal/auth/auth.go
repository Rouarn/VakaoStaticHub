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

var ErrInvalidToken = errors.New("invalid token")

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

type Claims struct {
	Sub      int64  `json:"sub"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Iat      int64  `json:"iat"`
	IatMS    int64  `json:"iatMs"`
	Exp      int64  `json:"exp"`
}

type Manager struct {
	secret []byte
	ttl    time.Duration
}

func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

func (m *Manager) TTL() time.Duration { return m.ttl }

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

func (m *Manager) TokenFromHeader(value string) (Claims, error) {
	const prefix = "Bearer "
	if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return Claims{}, ErrInvalidToken
	}
	return m.Parse(strings.TrimSpace(value[len(prefix):]))
}

func ParseUserID(value string) (int64, error) {
	return strconv.ParseInt(value, 10, 64)
}
