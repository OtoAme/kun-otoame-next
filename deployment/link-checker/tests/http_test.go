package evaluation

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KunMoe/kungal-link-live-checker/internal/checker"
	"github.com/KunMoe/kungal-link-live-checker/internal/httpapi"
	"github.com/KunMoe/kungal-link-live-checker/internal/provider/baidu"
	"github.com/KunMoe/kungal-link-live-checker/internal/provider/uc"
	"github.com/KunMoe/kungal-link-live-checker/internal/providerhttp"
	"github.com/KunMoe/kungal-link-live-checker/internal/ratelimit"
	"github.com/KunMoe/kungal-link-live-checker/internal/service"
)

const syntheticKey = "SYNTHETIC_SERVICE_AUTH_CANARY"
const syntheticPrivate = "SYNTHETIC_URL_CODE_COOKIE_BODY_CANARY"

type httpFixture struct {
	server       *httptest.Server
	logs         lockedLog
	mu           sync.Mutex
	privateCalls int
}

type lockedLog struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *lockedLog) Write(raw []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(raw)
}
func (b *lockedLog) String() string      { b.mu.Lock(); defer b.mu.Unlock(); return b.buffer.String() }
func (f *httpFixture) privateCount() int { f.mu.Lock(); defer f.mu.Unlock(); return f.privateCalls }

func newHTTPFixture(t *testing.T, ttl time.Duration, key string) *httpFixture {
	t.Helper()
	f := &httpFixture{}
	log := slog.New(slog.NewJSONHandler(&f.logs, nil))
	client := providerhttp.NewClient(time.Second)
	client.Transport = syntheticTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Hostname() == "127.0.0.1" {
			f.mu.Lock()
			f.privateCalls++
			f.mu.Unlock()
			return syntheticResponse(200, `{"code":41004}`), nil
		}
		id := ""
		if r.Method == http.MethodPost {
			var data map[string]string
			if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
				return nil, err
			}
			id = data["pwd_id"]
			if id == "SynTimeout" {
				<-r.Context().Done()
				return nil, context.DeadlineExceeded
			}
			if id == "SynHTML" {
				return syntheticResponse(200, "<html>synthetic captcha</html>"), nil
			}
			if id == "SynRedirect" {
				response := syntheticResponse(302, `{"code":41004}`)
				response.Header.Set("Location", "http://127.0.0.1:9876/"+syntheticPrivate)
				return response, nil
			}
			code := map[string]int{"SynDelete": 41004, "SynCancel": 41012, "SynExpired": 41011, "SynMissingCode": 41008, "SynBlocked": 41031, "SynUnknown": 99999, "SynHTTP503": 41004}[id]
			if id == "SynCredential" && data["passcode"] != "SYN_GOOD" {
				code = 41008
			}
			status := 200
			if id == "SynHTTP503" {
				status = 503
			}
			token := ""
			if code == 0 {
				token = id
			}
			body, _ := json.Marshal(map[string]any{"status": status, "code": code, "message": syntheticPrivate, "data": map[string]string{"stoken": token}})
			return syntheticResponse(status, string(body)), nil
		}
		id = r.URL.Query().Get("pwd_id")
		if id == "SynMissingDetail" {
			return syntheticResponse(200, `{}`), nil
		}
		body, _ := json.Marshal(map[string]any{"code": 0, "data": map[string]any{"share": map[string]any{"partial_violation": id == "SynPartial"}}})
		return syntheticResponse(200, string(body)), nil
	})
	provider := uc.New(uc.Options{TokenURL: "https://pc-api.uc.cn/token", DetailURL: "https://pc-api.uc.cn/detail", Client: client, Logger: log, VerifyDetail: true})
	svc := service.New(checker.NewRegistry(provider), ratelimit.NewRegistry(0, 1), service.Options{CheckTimeout: 50 * time.Millisecond, TTLAlive: ttl, TTLDead: ttl}, log)
	f.server = httptest.NewServer(httpapi.NewServer(svc, []string{key}, 1, log).Handler())
	t.Cleanup(f.server.Close)
	return f
}

func (f *httpFixture) request(t *testing.T, method, path, body, auth string) (int, http.Header, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, f.server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, resp.Header, raw
}

func (f *httpFixture) check(t *testing.T, id, code string) checker.Result {
	t.Helper()
	start := time.Now()
	body, _ := json.Marshal(map[string]string{"url": "https://drive.uc.cn/s/" + id, "passcode": code})
	status, headers, raw := f.request(t, http.MethodPost, "/v1/check", string(body), "Bearer "+syntheticKey)
	if status != 200 || headers.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("HTTP envelope: %d %v", status, headers)
	}
	var result checker.Result
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if !result.Cached && (result.CheckedAt.Before(start) || result.CheckedAt.After(time.Now())) {
		t.Fatal("checkedAt is not observation completion time")
	}
	if bytes.Contains(raw, []byte(syntheticPrivate)) || bytes.Contains(raw, []byte(syntheticKey)) || bytes.Contains(raw, []byte("https://")) {
		t.Fatal("private data in response")
	}
	t.Log("actual localhost HTTP: " + string(raw))
	return result
}

func TestAuthenticatedHTTPRegression30(t *testing.T) {
	f := newHTTPFixture(t, 0, syntheticKey)
	for _, tc := range []struct{ name, auth string }{{"missing-auth", ""}, {"wrong-auth", "Bearer SYN_WRONG"}, {"basic-auth", "Basic SYN"}} {
		t.Run(tc.name, func(t *testing.T) {
			status, _, raw := f.request(t, "POST", "/v1/check", `{"url":"https://drive.uc.cn/s/SynAlive"}`, tc.auth)
			if status != 401 || string(bytes.TrimSpace(raw)) != `{"error":"unauthorized"}` {
				t.Fatal("unauthorized not rejected")
			}
		})
	}
	t.Run("health-public", func(t *testing.T) {
		status, _, raw := f.request(t, "GET", "/healthz", "", "")
		if status != 200 || string(bytes.TrimSpace(raw)) != `{"status":"ok"}` {
			t.Fatal("health")
		}
	})
	for _, tc := range []struct{ name, body string }{{"empty-url", `{"url":" "}`}, {"invalid-json", `{`}, {"oversize-json", `{` + strings.Repeat(" ", 1<<20)}} {
		t.Run(tc.name, func(t *testing.T) {
			status, _, _ := f.request(t, "POST", "/v1/check", tc.body, "Bearer "+syntheticKey)
			if status != 400 {
				t.Fatal("bad input accepted")
			}
		})
	}
	t.Run("wrong-method", func(t *testing.T) {
		status, headers, _ := f.request(t, "GET", "/v1/check", "", "Bearer "+syntheticKey)
		if status != 405 || headers.Get("Cache-Control") != "private, no-store" {
			t.Fatal("method/privacy")
		}
	})
	t.Run("batch-bound", func(t *testing.T) {
		status, _, _ := f.request(t, "POST", "/v1/check/batch", `{"items":[{"url":"a"},{"url":"b"}]}`, "Bearer "+syntheticKey)
		if status != 400 {
			t.Fatal("batch bound")
		}
	})
	t.Run("unsupported-loopback", func(t *testing.T) {
		status, _, raw := f.request(t, "POST", "/v1/check", `{"url":"http://127.0.0.1/SYN"}`, "Bearer "+syntheticKey)
		var result checker.Result
		json.Unmarshal(raw, &result)
		if status != 200 || result.Reason != checker.ReasonUnsupported || f.privateCount() != 0 {
			t.Fatal("private target admitted")
		}
	})
	for _, tc := range []struct {
		id           string
		status       checker.Status
		reason, code string
	}{
		{"SynAlive", checker.StatusAlive, "share_ok", "0"},
		{"SynDelete", checker.StatusDead, "share_not_found", "41004"},
		{"SynCancel", checker.StatusDead, "share_not_found", "41012"},
		{"SynExpired", checker.StatusDead, "share_expired", "41011"},
		{"SynMissingCode", checker.StatusUnknown, "passcode_required", "41008"},
		{"SynBlocked", checker.StatusUnknown, "share_blocked", "41031"},
		{"SynPartial", checker.StatusUnknown, "share_blocked", "0/partial_violation"},
		{"SynUnknown", checker.StatusUnknown, "unparseable_response", ""},
		{"SynHTML", checker.StatusUnknown, "unparseable_response", ""},
		{"SynTimeout", checker.StatusUnknown, "timeout", ""},
	} {
		t.Run(tc.id, func(t *testing.T) {
			got := f.check(t, tc.id, "")
			if got.Status != tc.status || got.Reason != tc.reason || got.ProviderCode != tc.code || got.Cached {
				t.Fatalf("verdict: %+v", got)
			}
		})
	}
	for _, id := range []string{"SynMissingDetail", "SynHTTP503", "SynRedirect"} {
		t.Run("corrected-"+id, func(t *testing.T) {
			if got := f.check(t, id, ""); got.Status != checker.StatusUnknown {
				t.Fatalf("risk not corrected: %+v", got)
			}
		})
	}
	t.Run("private-redirect-blocked", func(t *testing.T) {
		if f.privateCount() != 0 {
			t.Fatal("private redirect reached transport")
		}
	})
	t.Run("zero-ttl-fresh", func(t *testing.T) {
		a := f.check(t, "SynAlive", "")
		b := f.check(t, "SynAlive", "")
		if a.Cached || b.Cached || a.CheckedAt.Equal(b.CheckedAt) {
			t.Fatal("stale observation reused")
		}
	})
	t.Run("changed-code-zero-cache", func(t *testing.T) {
		a := f.check(t, "SynCredential", "SYN_GOOD")
		b := f.check(t, "SynCredential", "SYN_BAD")
		if a.Status != checker.StatusAlive || b.Status != checker.StatusUnknown || b.Cached {
			t.Fatal("code crossed result")
		}
	})
	t.Run("no-store", func(t *testing.T) {
		_, headers, _ := f.request(t, "GET", "/healthz", "", "")
		if headers.Get("Cache-Control") != "private, no-store" {
			t.Fatal("privacy header missing")
		}
	})
	t.Run("safe-logs", func(t *testing.T) {
		for _, canary := range []string{syntheticPrivate, syntheticKey, "SYN_GOOD", "SYN_BAD", "https://"} {
			if strings.Contains(f.logs.String(), canary) {
				t.Fatal("private canary in logs")
			}
		}
	})
	t.Run("positive-ttl-no-code-cross-cache", func(t *testing.T) {
		g := newHTTPFixture(t, time.Hour, syntheticKey)
		a := g.check(t, "SynCredential", "SYN_GOOD")
		b := g.check(t, "SynCredential", "SYN_BAD")
		if a.Status != checker.StatusAlive || b.Status != checker.StatusUnknown || b.Cached {
			t.Fatal("positive TTL crossed code")
		}
		c := g.check(t, "SynCredential", "SYN_GOOD")
		if !c.Cached || !c.CheckedAt.Equal(a.CheckedAt) {
			t.Fatal("cache observation timestamp changed")
		}
	})
	t.Run("empty-key-fail-closed", func(t *testing.T) {
		g := newHTTPFixture(t, 0, "")
		status, _, _ := g.request(t, "POST", "/v1/check", `{"url":"https://drive.uc.cn/s/SynAlive"}`, "Bearer "+syntheticKey)
		if status != 401 {
			t.Fatal("empty configured key opened API")
		}
	})
}

func TestBaiduRetainsCallerRedirectPolicy(t *testing.T) {
	called := false
	sink := false
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { called = true; return http.ErrUseLastResponse }, Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Hostname() == "127.0.0.1" {
			sink = true
			return syntheticResponse(200, `{"errno":-21}`), nil
		}
		resp := syntheticResponse(302, "")
		resp.Header.Set("Location", "http://127.0.0.1:9876/SYN")
		return resp, nil
	})}
	c := baidu.New(baidu.Options{Client: client, Logger: quietLogger()})
	got := c.Check(context.Background(), syntheticURL("https://pan.baidu.com/s/1SYNTHETIC"), "")
	if !called || sink || got.Status != checker.StatusUnknown {
		t.Fatalf("redirect policy lost: called=%v sink=%v verdict=%+v", called, sink, got)
	}
}
