package evaluation

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/KunMoe/kungal-link-live-checker/internal/checker"
	"github.com/KunMoe/kungal-link-live-checker/internal/provider/baidu"
	"github.com/KunMoe/kungal-link-live-checker/internal/provider/caiyun"
	"github.com/KunMoe/kungal-link-live-checker/internal/provider/pan123"
	"github.com/KunMoe/kungal-link-live-checker/internal/provider/quarkfamily"
)

type syntheticTransport func(*http.Request) (*http.Response, error)

func (f syntheticTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func syntheticResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
func syntheticURL(raw string) *url.URL { u, _ := url.Parse(raw); return u }
func quietLogger() *slog.Logger        { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestInvalidProviderResponsesCannotChangeHealth(t *testing.T) {
	for _, name := range []string{"quark", "uc", "baidu", "caiyun", "pan123"} {
		for _, tc := range []struct {
			name   string
			status int
			body   string
		}{
			{"missing-fields", 200, `{}`},
			{"null", 200, `null`},
			{"malformed", 200, `{"code":`},
			{"duplicate-code", 200, `{"code":0,"code":41004,"errno":-21}`},
			{"wrong-code-type", 200, `{"code":true,"errno":"-21"}`},
			{"rate-limit", 429, `{"code":41004,"errno":-21}`},
			{"upstream-failure", 503, `{"code":41004,"errno":-21}`},
			{"redirect-envelope", 302, `{"code":41004,"errno":-21}`},
			{"oversize-valid-prefix", 200, `{"code":41004,"errno":-21}` + strings.Repeat(" ", 1<<20)},
		} {
			t.Run(name+"/"+tc.name, func(t *testing.T) {
				client := &http.Client{Transport: syntheticTransport(func(*http.Request) (*http.Response, error) { return syntheticResponse(tc.status, tc.body), nil })}
				var c checker.Checker
				var raw string
				switch name {
				case "quark", "uc":
					raw = "https://pan.quark.cn/s/SYNTHETIC"
					c = quarkfamily.New(quarkfamily.Config{Name: name, TokenURL: "https://drive-pc.quark.cn/token", DetailURL: "https://drive-pc.quark.cn/detail", Client: client, Logger: quietLogger()})
				case "baidu":
					raw = "https://pan.baidu.com/s/1SYNTHETIC"
					c = baidu.New(baidu.Options{Client: client, Logger: quietLogger()})
				case "caiyun":
					raw = "https://caiyun.139.com/m/i?SYNTHETIC"
					c = caiyun.New(caiyun.Options{Client: client, Logger: quietLogger()})
				case "pan123":
					raw = "https://www.123pan.com/s/SYNTHETIC"
					c = pan123.New(pan123.Options{Client: client, Logger: quietLogger()})
				}
				got := c.Check(context.Background(), syntheticURL(raw), "")
				if got.Status != checker.StatusUnknown {
					t.Fatalf("unsafe health result: %+v", got)
				}
			})
		}
	}
}

func TestProviderRegression24(t *testing.T) {
	cases := []struct {
		provider, name, body, page string
		status                     checker.Status
		reason, code               string
	}{
		{"baidu", "public", `{"errno":0,"shareid":1,"uk":2}`, "", checker.StatusAlive, "share_ok", "0"},
		{"baidu", "deleted", `{"errno":-21}`, "", checker.StatusDead, "share_not_found", "-21"},
		{"baidu", "cancelled-page", `{"errno":-9}`, `<title>百度网盘-链接不存在</title>`, checker.StatusDead, "share_not_found", "-9/page"},
		{"baidu", "passcode-page", `{"errno":-9}`, `<title>请输入提取码</title>`, checker.StatusUnknown, "passcode_required", "-9/page"},
		{"baidu", "neutral-page", `{"errno":-9}`, `<title>synthetic</title>`, checker.StatusUnknown, "passcode_required", "-9"},
		{"baidu", "missing-errno", `{}`, "", checker.StatusUnknown, "unparseable_response", ""},
		{"baidu", "unknown-errno", `{"errno":99999}`, "", checker.StatusUnknown, "unparseable_response", ""},
		{"caiyun", "public", `{"code":"0","success":true,"data":{"synthetic":true}}`, "", checker.StatusAlive, "share_ok", "0"},
		{"caiyun", "wrong-code", `{"code":"9188"}`, "", checker.StatusUnknown, "passcode_required", "9188"},
		{"caiyun", "cancelled", `{"code":"200000727"}`, "", checker.StatusDead, "share_not_found", "200000727"},
		{"caiyun", "unknown-code", `{"code":"99999"}`, "", checker.StatusUnknown, "unparseable_response", ""},
		{"pan123", "public", `{"code":0,"message":"ok","data":{"synthetic":true}}`, "", checker.StatusAlive, "share_ok", "0"},
		{"pan123", "deleted", `{"code":5103,"message":"此分享不存在"}`, "", checker.StatusDead, "share_not_found", "5103"},
		{"pan123", "wrong-code", `{"code":5103,"message":"提取码错误"}`, "", checker.StatusUnknown, "passcode_required", "5103"},
		{"pan123", "ambiguous-message", `{"code":5103,"message":"synthetic"}`, "", checker.StatusUnknown, "unparseable_response", "5103"},
		{"pan123", "missing-code", `{}`, "", checker.StatusUnknown, "unparseable_response", ""},
	}
	for _, tc := range cases {
		t.Run(tc.provider+"/"+tc.name, func(t *testing.T) {
			seenPageCode := false
			client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
				if tc.provider == "baidu" && r.URL.Path == "/" {
					resp := syntheticResponse(200, "synthetic")
					resp.Header.Set("Set-Cookie", "BAIDUID=SYNTHETIC; Path=/")
					return resp, nil
				}
				if tc.provider == "baidu" && strings.HasPrefix(r.URL.Path, "/s/") {
					seenPageCode = r.URL.Query().Get("pwd") == "SYN_CODE"
					return syntheticResponse(200, tc.page), nil
				}
				return syntheticResponse(200, tc.body), nil
			})}
			var c checker.Checker
			raw := ""
			switch tc.provider {
			case "baidu":
				c = baidu.New(baidu.Options{Client: client, Logger: quietLogger()})
				raw = "https://pan.baidu.com/s/1SYNTHETIC"
			case "caiyun":
				c = caiyun.New(caiyun.Options{Client: client, Logger: quietLogger()})
				raw = "https://caiyun.139.com/m/i?SYNTHETIC"
			case "pan123":
				c = pan123.New(pan123.Options{Client: client, Logger: quietLogger()})
				raw = "https://www.123pan.com/s/SYNTHETIC"
			}
			got := c.Check(context.Background(), syntheticURL(raw), "SYN_CODE")
			if got.Status != tc.status || got.Reason != tc.reason || got.ProviderCode != tc.code {
				t.Fatalf("verdict %+v", got)
			}
			if tc.page != "" && !seenPageCode {
				t.Fatal("fallback did not receive synthetic code")
			}
		})
	}
	for _, raw := range []string{"https://www.123pan.com:9443/s/SYN", "https://arbitrary.123pan.com/s/SYN"} {
		t.Run("rejected-"+raw, func(t *testing.T) {
			c := pan123.New(pan123.Options{Logger: quietLogger()})
			if c.Matches(syntheticURL(raw)) {
				t.Fatal("unapproved authority matched")
			}
		})
	}
	for _, tc := range []struct {
		name          string
		status        int
		token, detail string
	}{{"missing-detail", 200, `{"code":0,"data":{"stoken":"SYN"}}`, `{}`}, {"503-gone-code", 503, `{"code":41004}`, `{}`}} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method == "POST" {
					return syntheticResponse(tc.status, tc.token), nil
				}
				return syntheticResponse(200, tc.detail), nil
			})}
			c := quarkfamily.New(quarkfamily.Config{Name: "quark", TokenURL: "https://drive-pc.quark.cn/token", DetailURL: "https://drive-pc.quark.cn/detail", Client: client, Logger: quietLogger()})
			if got := c.Check(context.Background(), syntheticURL("https://pan.quark.cn/s/SYN"), ""); got.Status != checker.StatusUnknown {
				t.Fatal("unsafe verdict")
			}
		})
	}
	t.Run("baidu-redirect-policy", TestBaiduRetainsCallerRedirectPolicy)
	t.Run("quark-code-forwarded", func(t *testing.T) {
		seen := false
		client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)
			seen = strings.Contains(string(body), `"passcode":"SYN_CODE"`)
			return syntheticResponse(404, `{"code":41008}`), nil
		})}
		c := quarkfamily.New(quarkfamily.Config{Name: "quark", TokenURL: "https://drive-pc.quark.cn/token", Client: client, Logger: quietLogger()})
		c.Check(context.Background(), syntheticURL("https://pan.quark.cn/s/SYN?pwd=SYN_OTHER"), "SYN_CODE")
		if !seen {
			t.Fatal("explicit code not forwarded")
		}
	})
	t.Run("pan123-code-forwarded", func(t *testing.T) {
		seen := false
		client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
			seen = r.URL.Query().Get("SharePwd") == "SYN_CODE"
			return syntheticResponse(200, `{"code":5103,"message":"提取码错误"}`), nil
		})}
		c := pan123.New(pan123.Options{Client: client, Logger: quietLogger()})
		c.Check(context.Background(), syntheticURL("https://www.123pan.com/s/SYN?pwd=SYN_CODE"), "")
		if !seen {
			t.Fatal("code not forwarded")
		}
	})
	t.Run("caiyun-no-code-forwarded", func(t *testing.T) {
		leaked := false
		client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)
			leaked = strings.Contains(string(body), "SYN_CODE")
			return syntheticResponse(200, `{"code":"9188"}`), nil
		})}
		c := caiyun.New(caiyun.Options{Client: client, Logger: quietLogger()})
		c.Check(context.Background(), syntheticURL("https://caiyun.139.com/m/i?SYN"), "SYN_CODE")
		if leaked {
			t.Fatal("unneeded code forwarded")
		}
	})
}

func TestIncompleteDetailCannotClaimAvailable(t *testing.T) {
	for _, body := range []string{`{}`, `{"code":0}`, `{"code":0,"data":{}}`, `{"code":0,"data":{"share":{}}}`, `{"code":0,"data":{"share":{"partial_violation":null}}}`} {
		t.Run(body, func(t *testing.T) {
			client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method == "POST" {
					return syntheticResponse(200, `{"code":0,"data":{"stoken":"SYN"}}`), nil
				}
				return syntheticResponse(200, body), nil
			})}
			c := quarkfamily.New(quarkfamily.Config{Name: "quark", TokenURL: "https://drive-pc.quark.cn/token", DetailURL: "https://drive-pc.quark.cn/detail", Client: client, Logger: quietLogger()})
			if got := c.Check(context.Background(), syntheticURL("https://pan.quark.cn/s/SYNTHETIC"), ""); got.Status != checker.StatusUnknown {
				t.Fatalf("incomplete detail claimed available: %+v", got)
			}
		})
	}
}

func TestCaseFoldedProviderFieldsCannotProduceActionableVerdicts(t *testing.T) {
	for _, tc := range []struct{ name, token, detail string }{
		{"code/Code", `{"code":0,"Code":41004,"data":{"stoken":"SYN"}}`, `{"code":0,"data":{"share":{"partial_violation":false}}}`},
		{"data/DATA", `{"code":0,"data":{"stoken":"SYN"}}`, `{"code":0,"data":{"share":{"partial_violation":true}},"DATA":{"share":{"partial_violation":false}}}`},
		{"partial flag", `{"code":0,"data":{"stoken":"SYN"}}`, `{"code":0,"data":{"share":{"partial_violation":true,"PARTIAL_VIOLATION":false}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: syntheticTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method == "POST" {
					return syntheticResponse(200, tc.token), nil
				}
				return syntheticResponse(200, tc.detail), nil
			})}
			c := quarkfamily.New(quarkfamily.Config{Name: "quark", TokenURL: "https://drive-pc.quark.cn/token", DetailURL: "https://drive-pc.quark.cn/detail", Client: client, Logger: quietLogger()})
			if got := c.Check(context.Background(), syntheticURL("https://pan.quark.cn/s/SYN"), ""); got.Status != checker.StatusUnknown {
				t.Fatalf("ambiguous response produced %+v", got)
			}
		})
	}
}
