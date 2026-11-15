// 包 cdn 负责把分享文件的 CDN 缓存按目录前缀刷新。
//
// 对外只有一个入口 PurgePrefix：撤销分享时一次性丢掉
// `/v1/s/<token>/f/` 下的全部文件与变体，不逐条刷新。
// 凭据留空时整个包空转；刷新失败只记日志，绝不影响删除/停用分享本身。
package cdn

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	apiHost  = "teo.tencentcloudapi.com"
	service  = "teo"
	version  = "2022-09-01"
	action   = "CreatePurgeTask"
	purgeTTL = 10 * time.Second
)

// Config 是 CDN 刷新的凭据配置；任一项为空即视为未启用。
type Config struct {
	SecretID  string
	SecretKey string
	ZoneID    string
	Logger    *slog.Logger
}

// Client 是 CDN 缓存刷新客户端。
type Client struct {
	config   Config
	endpoint string
	http     *http.Client
	logger   *slog.Logger
}

func New(cfg Config) *Client {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		config:   cfg,
		endpoint: "https://" + apiHost + "/",
		http:     &http.Client{Timeout: purgeTTL},
		logger:   logger,
	}
}

// PurgePrefix 按目录前缀刷新缓存，覆盖该前缀下的所有文件与变体。
// 未配置凭据时直接返回；任何失败只写日志，不返回错误、不重试。
func (c *Client) PurgePrefix(ctx context.Context, origin, pathPrefix string) {
	if !c.enabled() {
		return
	}
	if origin == "" || pathPrefix == "" {
		c.logger.Warn("cdn purge skipped: empty origin or prefix")
		return
	}
	url := strings.TrimRight(origin, "/") + pathPrefix
	payload, err := json.Marshal(map[string]any{
		"ZoneId":  c.config.ZoneID,
		"Type":    "purge_prefix",
		"Targets": []string{url},
	})
	if err != nil {
		c.logger.Error("cdn purge marshal failed", "prefix", url, "err", err)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		c.logger.Error("cdn purge request failed", "prefix", url, "err", err)
		return
	}
	c.sign(req, payload)
	resp, err := c.http.Do(req)
	if err != nil {
		c.logger.Error("cdn purge failed", "prefix", url, "err", err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if apiErr := parseError(body); apiErr != "" {
		c.logger.Error("cdn purge rejected", "prefix", url, "status", resp.StatusCode, "err", apiErr)
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.logger.Error("cdn purge rejected", "prefix", url, "status", resp.StatusCode, "body", string(body))
		return
	}
	c.logger.Info("cdn purge submitted", "prefix", url)
}

func (c *Client) enabled() bool {
	return c.config.SecretID != "" && c.config.SecretKey != "" && c.config.ZoneID != ""
}

// sign 按腾讯云 TC3-HMAC-SHA256 规范签名。
func (c *Client) sign(req *http.Request, payload []byte) {
	timestamp := time.Now().Unix()
	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")
	contentType := "application/json; charset=utf-8"

	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-TC-Action", action)
	req.Header.Set("X-TC-Version", version)
	req.Header.Set("X-TC-Timestamp", strconv.FormatInt(timestamp, 10))

	canonicalHeaders := "content-type:" + contentType + "\nhost:" + apiHost + "\n"
	signedHeaders := "content-type;host"
	canonicalRequest := strings.Join([]string{
		http.MethodPost,
		"/",
		"",
		canonicalHeaders,
		signedHeaders,
		hashHex(payload),
	}, "\n")

	scope := date + "/" + service + "/tc3_request"
	stringToSign := strings.Join([]string{
		"TC3-HMAC-SHA256",
		strconv.FormatInt(timestamp, 10),
		scope,
		hashHex([]byte(canonicalRequest)),
	}, "\n")

	secretDate := hmacSHA256([]byte("TC3"+c.config.SecretKey), date)
	secretService := hmacSHA256(secretDate, service)
	secretSigning := hmacSHA256(secretService, "tc3_request")
	signature := hex.EncodeToString(hmacSHA256(secretSigning, stringToSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		c.config.SecretID, scope, signedHeaders, signature,
	))
}

// parseError 提取腾讯云返回的错误信息；没有错误时返回空串。
func parseError(body []byte) string {
	var resp struct {
		Response struct {
			Error *struct {
				Code    string `json:"Code"`
				Message string `json:"Message"`
			} `json:"Error"`
		} `json:"Response"`
	}
	if err := json.Unmarshal(body, &resp); err != nil || resp.Response.Error == nil {
		return ""
	}
	return resp.Response.Error.Code + ": " + resp.Response.Error.Message
}

func hashHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}
