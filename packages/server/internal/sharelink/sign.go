// 公开分享的文件地址签名。
//
// 公开分享没有密码，文件地址本身就是凭证：为了让同一版本的同一个文件
// 永远得到同一个地址（CDN 才能真正复用缓存），地址里携带的是对
// 「分享 + 文件 + 版本」的 HMAC 签名，而不是每次访问都变的会话令牌。
//
// 签名不设有效期，但服务端每次请求都会重新读取分享状态，
// 因此取消、停用、过期、次数用尽后同一地址立即失效。
// 密钥来自 SHARE_SIGN_KEY，换密钥即让全部旧签名一次性作废。
package sharelink

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
)

// Signer 用服务端密钥为分享文件地址签名。
type Signer struct {
	secret []byte
}

func NewSigner(secret string) *Signer {
	return &Signer{secret: []byte(secret)}
}

// Sign 返回某个分享内某个文件在指定版本下的稳定签名。
func (s *Signer) Sign(shareToken string, fileIndex int, version string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write(s.payload(shareToken, fileIndex, version))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Verify 校验签名是否与当前分享、文件下标与版本匹配。
func (s *Signer) Verify(shareToken string, fileIndex int, version, signature string) bool {
	if signature == "" {
		return false
	}
	expected := s.Sign(shareToken, fileIndex, version)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// payload 是参与签名的原文：分享标识、文件下标、文件版本缺一不可。
func (s *Signer) payload(shareToken string, fileIndex int, version string) []byte {
	buf := make([]byte, 0, len(shareToken)+len(version)+12)
	buf = append(buf, shareToken...)
	buf = append(buf, '\n')
	buf = strconv.AppendInt(buf, int64(fileIndex), 10)
	buf = append(buf, '\n')
	buf = append(buf, version...)
	return buf
}
