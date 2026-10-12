package providerhttp

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestShareAuthoritiesAreExactHTTPSDefaultPort(t *testing.T) {
	for _, raw := range []string{"https://pan.quark.cn/s/SYN", "https://drive.uc.cn:443/s/SYN", "https://www.123pan.com/s/SYN", "https://caiyun.139.com/front/#/detail?linkID=SYN"} {
		u, _ := url.Parse(raw)
		if !ShareURLAllowed(u) {
			t.Fatalf("valid share authority rejected: %s", raw)
		}
	}
	for _, raw := range []string{"http://pan.quark.cn/s/SYN", "https://pan.quark.cn:9443/s/SYN", "https://pan.quark.cn:/s/SYN", "https://pan.quark.cn:0443/s/SYN", "https://SYN:SYN@pan.quark.cn/s/SYN", "https://pan.quark.cn./s/SYN", "https://pan.quark.cn.evil.invalid/s/SYN", "https://arbitrary.123pan.com/s/SYN", "https://123.share.123pan.cn/123pan/SYN", "https://127.0.0.1/s/SYN", "https://[::1]/s/SYN"} {
		u, _ := url.Parse(raw)
		if ShareURLAllowed(u) {
			t.Fatalf("unapproved share authority admitted: %s", raw)
		}
	}
}

func TestPublicAddressPolicyIncludesIPv6AndMappedIPv4(t *testing.T) {
	for _, raw := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"} {
		if !publicAddress(netip.MustParseAddr(raw)) {
			t.Fatalf("public rejected: %s", raw)
		}
	}
	for _, raw := range []string{"0.0.0.0", "0.1.2.3", "10.1.1.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.0.9", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.1.1.1", "255.255.255.255", "::", "::1", "fc00::1", "fd00::1", "fe80::1", "fe80::1%lo0", "fec0::1", "ff02::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2001::1", "2001:db8::1", "2002:a00:1::1", "3fff::1"} {
		if publicAddress(netip.MustParseAddr(raw)) {
			t.Fatalf("special-use admitted: %s", raw)
		}
	}
}

func TestDialRejectsPrivateAndMixedAnswersBeforeConnecting(t *testing.T) {
	for _, answers := range [][]netip.Addr{{}, {netip.MustParseAddr("127.0.0.1")}, {netip.MustParseAddr("::1")}, {netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("10.0.0.1")}, {netip.MustParseAddr("2606:4700::1111"), netip.MustParseAddr("fd00::1")}} {
		calls := 0
		dial := providerDial(func(context.Context, string, string) ([]netip.Addr, error) { return answers, nil }, func(context.Context, string, string) (net.Conn, error) { calls++; return nil, errors.New("synthetic") })
		if _, err := dial(context.Background(), "tcp", "drive-pc.quark.cn:443"); err == nil || calls != 0 {
			t.Fatalf("unsafe DNS reached dial: calls=%d err=%v", calls, err)
		}
	}
}

func TestDialBindsValidatedIPWithoutSecondDNSLookup(t *testing.T) {
	for _, answer := range []string{"8.8.8.8", "2606:4700:4700::1111"} {
		t.Run(answer, func(t *testing.T) {
			lookups := 0
			destination := ""
			dial := providerDial(func(context.Context, string, string) ([]netip.Addr, error) {
				lookups++
				if lookups > 1 {
					return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
				}
				return []netip.Addr{netip.MustParseAddr(answer)}, nil
			}, func(_ context.Context, _ string, authority string) (net.Conn, error) {
				destination = authority
				left, right := net.Pipe()
				right.Close()
				return left, nil
			})
			conn, err := dial(context.Background(), "tcp", "drive-pc.quark.cn:443")
			if err != nil {
				t.Fatal(err)
			}
			conn.Close()
			if lookups != 1 || destination != net.JoinHostPort(answer, "443") {
				t.Fatalf("not bound: lookups=%d destination=%s", lookups, destination)
			}
		})
	}
}

func TestDialRejectsUnknownHostAndPortBeforeDNS(t *testing.T) {
	calls := 0
	dial := providerDial(func(context.Context, string, string) ([]netip.Addr, error) { calls++; return nil, nil }, nil)
	for _, authority := range []string{"127.0.0.1:443", "drive-pc.quark.cn:80", "drive-pc.quark.cn:9443", "arbitrary.123pan.com:443", "drive-pc.quark.cn.:443"} {
		if _, err := dial(context.Background(), "tcp", authority); err == nil {
			t.Fatal("authority admitted")
		}
	}
	if calls != 0 {
		t.Fatal("unapproved authority reached DNS")
	}
}

func TestRestrictedTransportRejectsURLBeforeDNS(t *testing.T) {
	client := NewClient(time.Second)
	for _, raw := range []string{"http://drive-pc.quark.cn/token", "https://drive-pc.quark.cn:9443/token", "https://SYN:SYN@drive-pc.quark.cn/token", "https://127.0.0.1/token", "https://arbitrary.123pan.com/token"} {
		if _, err := client.Get(raw); err == nil {
			t.Fatalf("unapproved URL admitted: %s", raw)
		}
	}
}

func TestTLSKeepsProviderHostnameAndRedirectsNeverReachPrivateSink(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), DNSNames: []string{"drive-pc.quark.cn"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	sni := ""
	calls := 0
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		sni = r.TLS.ServerName
		w.Header().Set("Location", "http://127.0.0.1:9876/SYN_PRIVATE")
		w.WriteHeader(302)
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
	srv.StartTLS()
	defer srv.Close()
	client := NewClient(time.Second)
	transport := client.Transport.(restrictedTransport).base
	transport.TLSClientConfig = &tls.Config{RootCAs: pool}
	transport.DialContext = providerDial(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}, func(ctx context.Context, network, authority string) (net.Conn, error) {
		if authority != "8.8.8.8:443" {
			t.Fatal("unbound dial")
		}
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	})
	resp, err := client.Get("https://drive-pc.quark.cn/token")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 302 || sni != "drive-pc.quark.cn" || calls != 1 {
		t.Fatalf("TLS/redirect policy not preserved: status=%d sni=%s calls=%d", resp.StatusCode, sni, calls)
	}
	// The same bound IP does not make a certificate for another provider valid.
	if _, err := client.Get("https://pc-api.uc.cn/token"); err == nil {
		t.Fatal("wrong provider certificate accepted")
	}
	transport.CloseIdleConnections()
}

func TestBodyCapRejectsValidTruncatedPrefix(t *testing.T) {
	if _, err := ReadBody(strings.NewReader(`{"code":41004}`+strings.Repeat(" ", 100)), 20); err == nil {
		t.Fatal("overflow accepted")
	}
	if raw, err := ReadBody(strings.NewReader("12345"), 5); err != nil || string(raw) != "12345" {
		t.Fatal("exact cap rejected")
	}
}

func TestProviderJSONRejectsDuplicateKeysAndTrailingValues(t *testing.T) {
	for _, raw := range []string{`{"code":0,"code":41004}`, `{"data":{"share":{"partial_violation":true,"partial_violation":false}}}`, `{"code":0} {"code":41004}`} {
		var target any
		if DecodeJSON([]byte(raw), &target) == nil {
			t.Fatalf("ambiguous JSON accepted: %s", raw)
		}
	}
	var target any
	if err := DecodeJSON([]byte(`{"code":41004,"data":[{"x":1}]}`), &target); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadBody(io.LimitReader(strings.NewReader("x"), 0), 10); err != nil {
		t.Fatal(err)
	}
}

func TestProviderJSONRejectsStructEquivalentKeys(t *testing.T) {
	for _, raw := range []string{
		`{"code":0,"Code":41004}`,
		`{"data":{"value":1},"DATA":{"value":2}}`,
		`{"data":{"share":{"partial_violation":true,"PARTIAL_VIOLATION":false}}}`,
		`{"status":1,"ſtatus":2}`,
		`{"key":1,"Key":2}`,
	} {
		t.Run(raw, func(t *testing.T) {
			var target any
			if DecodeJSON([]byte(raw), &target) == nil {
				t.Fatal("struct-equivalent keys accepted")
			}
		})
	}
}
