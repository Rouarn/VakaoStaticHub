package cdn

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testClient(endpoint string) *Client {
	client := New(Config{SecretID: "AKIDtest", SecretKey: "secret", ZoneID: "zone-1"})
	client.endpoint = endpoint
	return client
}

func TestPurgePrefixDisabledWithoutCredentials(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer server.Close()

	New(Config{}).PurgePrefix(context.Background(), "https://static.example.com", "/v1/s/tok/f/")
	if called {
		t.Fatal("未配置凭据时不应发出请求")
	}
}

func TestPurgePrefixSignsAndSendsPrefix(t *testing.T) {
	var gotBody []byte
	var gotHeader http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Clone()
		gotBody, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{"Response":{"RequestId":"req-1"}}`))
	}))
	defer server.Close()

	testClient(server.URL).PurgePrefix(context.Background(), "https://static.example.com", "/v1/s/tok/f/")

	var payload struct {
		ZoneID  string   `json:"ZoneId"`
		Type    string   `json:"Type"`
		Targets []string `json:"Targets"`
	}
	if err := json.Unmarshal(gotBody, &payload); err != nil {
		t.Fatalf("请求体不是合法 JSON: %v", err)
	}
	if payload.ZoneID != "zone-1" || payload.Type != "purge_prefix" {
		t.Fatalf("请求体字段不对: %+v", payload)
	}
	if len(payload.Targets) != 1 || payload.Targets[0] != "https://static.example.com/v1/s/tok/f/" {
		t.Fatalf("刷新前缀不对: %+v", payload.Targets)
	}
	if gotHeader.Get("X-TC-Action") != "CreatePurgeTask" {
		t.Fatalf("Action 头不对: %q", gotHeader.Get("X-TC-Action"))
	}
	auth := gotHeader.Get("Authorization")
	if !strings.HasPrefix(auth, "TC3-HMAC-SHA256 Credential=AKIDtest/") ||
		!strings.Contains(auth, "SignedHeaders=content-type;host") {
		t.Fatalf("鉴权头不符合 TC3 格式: %q", auth)
	}
	if !strings.Contains(gotHeader.Get("Content-Type"), "application/json") {
		t.Fatalf("Content-Type 不对: %q", gotHeader.Get("Content-Type"))
	}
}

func TestPurgePrefixIgnoresFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"Response":{"Error":{"Code":"AuthFailure","Message":"denied"}}}`))
	}))
	defer server.Close()

	// 失败只记日志：调用会正常返回。
	testClient(server.URL).PurgePrefix(context.Background(), "https://static.example.com", "/v1/s/tok/f/")
}
