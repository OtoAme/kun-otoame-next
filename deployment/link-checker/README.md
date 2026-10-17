# Pinned OtoAme link checker

This directory contains a bounded patch and regression overlays for [kungal/kungal-link-live-checker](https://github.com/kungal/kungal-link-live-checker) at `c74022f4dbbb7c8c39be7da15701763efa2ffffd`; it does not vendor the upstream repository. `pin.json` binds the upstream archive and patch hashes. `UPSTREAM-LICENSE` preserves the upstream AGPL-3.0 license; distribute the exact patched source, license and manifest with any service artifact.

These instructions describe this pinned service artifact. Current website integration with remote LLC supports five providers, recent cached observations and explicit blocked verdicts; see the [website contract](../../docs/modules/api-services.md#链接报告健康与检测040510) and [connection settings](../../README.md#link-live-checker-接入). The pinned patch itself still returns unknown for blocked results and its example disables four providers.

The HTTP interface remains `POST /v1/check`, JSON `url` and optional `passcode`, `Authorization: Bearer`, and `provider/status/reason/providerCode/checkedAt/cached` results. Empty service keys reject all business requests. Provider faults remain HTTP 200 with unknown; `/healthz` is public and only confirms the process runs. Results and error responses use `private, no-store`.

## Build and verify

Use existing Python 3, git and Go (the pinned source requires Go 1.23+). The build command performs no dependency installation or live provider probes. Its tests create only local HTTP/TLS fixtures, synthetic DNS and transport responses. Build source, logs, caches and binaries stay in a **new** directory outside the repository; an existing directory is rejected without replacement.

Download the exact public archive to your isolated task directory if it is not already available:

```sh
curl --proto '=https' --connect-timeout 10 --max-time 30 -fL \
  https://codeload.github.com/kungal/kungal-link-live-checker/tar.gz/c74022f4dbbb7c8c39be7da15701763efa2ffffd \
  -o /private/tmp/otoame-ops-20261009/checker/pinned-source.tar.gz
```

Build the native artifact (the output directory must not exist):

```sh
python3 deployment/link-checker/build.py \
  --archive /private/tmp/otoame-ops-20261009/checker/pinned-source.tar.gz \
  --work-dir /private/tmp/otoame-ops-20261009/checker/native-build
```

For a Linux amd64 target, use a different new directory and add `--goos linux --goarch amd64`. Tests still run natively before cross-compilation. All Go paths are isolated, toolchain downloads/proxies are disabled, and no repository environment or upstream deployment script is loaded. `manifest.json` records revision, archive/patch/overlay/source/binary hashes, toolchain metadata and actual test counts. `bin/llc` is the exact tested-source artifact. Run `go test -json -count=1 ./evaluation ./internal/providerhttp` in the prepared source to focus on the regressions.

Exercise the exact native binary, authentication and outbound rejection over real localhost HTTP:

```sh
python3 deployment/link-checker/smoke.py \
  --manifest /private/tmp/otoame-ops-20261009/checker/native-build/manifest.json \
  --report /private/tmp/otoame-ops-20261009/checker/native-smoke.json
```

The smoke requests are synthetic, and its configured loopback provider endpoint must receive zero calls. It stops its checker and fixture before returning; the three-state HTTP regression uses the actual handler/service/providers with a synthetic provider transport in the Go suite.

## Local run and service draft

An isolated local launch supplies only dedicated service configuration; this example deliberately leaves the API key empty and providers other than Quark disabled:

```sh
env -i PATH=/usr/bin:/bin LLC_ADDR=127.0.0.1:6734 LLC_API_KEYS= \
  LLC_CHECK_TIMEOUT=2s LLC_RATE_RPS=1 LLC_RATE_BURST=1 LLC_BATCH_MAX=1 \
  LLC_CACHE_TTL_ALIVE=0s LLC_CACHE_TTL_DEAD=0s LLC_CACHE_TTL_UNKNOWN=0s \
  LLC_QUARK_VERIFY_DETAIL=true LLC_QUARK_BLOCKED_AS_DEAD=false \
  LLC_UC_ENABLED=false LLC_BAIDU_ENABLED=false LLC_CAIYUN_ENABLED=false LLC_PAN123_ENABLED=false \
  /private/tmp/otoame-ops-20261009/checker/native-build/bin/llc
```

Supply a dedicated service key through the operator's process/service configuration for authenticated checks. Do not use a website login token, user cookie or extraction/unzip password as service authentication. The checker owns Baidu's anonymous cookie jar. It needs no database, Redis, S3, mail service, browser or scanning task.

`checker.conf.example` and `otoame-link-checker.service` are deployment drafts, **not installed services**. After explicit production approval, use an immutable reviewed artifact under `/opt/otoame-link-checker/releases/<revision>-<patch-hash>/llc`, atomically point `current` to it, and keep a root-managed 0600 `/etc/otoame-link-checker/checker.conf`. Retain the previous artifact for rollback. Verify the manifest and target architecture first. The unit runs a dynamic unprivileged user with read-only system/home, private tmp and bounded restarts/resources; target Linux/systemd and limits require target-host validation.

The example disables UC/Baidu/Caiyun/123; those requests return unknown. Their implementations remain available for synthetic verification and explicit enablement. Quark is always registered by the pinned entry point. This artifact's live acceptance covers a normal and an abnormal Quark sample; individual deleted/cancelled/expired branches are covered by synthetic regressions. Its blocked 41010 response remains unknown under the patch's own provider policy.

Keep the checker on its own egress IP, separate from identity/login traffic. Its listener defaults to `127.0.0.1:6734`; a cross-host caller uses separately approved private TLS ingress restricted to the website backend. Forward only `/v1/check`, preserve Authorization, disable caching, bound request size/concurrency, and omit request body/arguments/authorization from logs. `LLC_BATCH_MAX=1` limits batch size but does not remove the batch route; deny it at ingress. No private ingress, system service or cloud resource is provisioned by these assets.

## Hardened boundaries and sample qualification

- All user share and provider API URLs require HTTPS, exact allowed hosts, no userinfo and port absent or exactly 443. The 123 list contains `123pan.com`, `123684.com`, `123865.com`, `123912.com` and their `www` forms; arbitrary subdomains, personal `share.123pan.cn` and other aliases are unknown until a separately reviewed exact-host addition and live samples. No regex wildcard is used.
- The provider transport disables environment proxies, validates every resolved IPv4/IPv6 address at the actual dial, rejects private/special-use/mixed answers and binds the connection to the vetted literal IP. TLS still validates the original provider hostname. All redirects are rejected, including Baidu's rewrapped client. Loopback endpoint overrides cannot bypass the shipped transport.
- Required numeric/string codes and success fields, token/detail shapes, positive Baidu share identifiers and nonempty successful data objects are checked. Duplicate JSON keys, malformed/trailing values, over-limit bodies and 429/5xx/redirect responses are unknown. Only explicitly mapped Quark/UC 403/404 JSON codes are retained; other providers require HTTP 200.
- Reads use cap+1: JSON 1 MiB, Baidu page 512 KiB and cookie warmup 64 KiB. Quark/UC missing detail cannot claim available. Blocked and partial-violation results stay unknown even with the legacy blocked-as-dead flag. Baidu extraction-code pages, Caiyun 9188 and 123 wrong-code 5103 are unknown. 123 gone 5103 requires the exact audited 不存在 message, while Baidu's page-negative candidate requires the existing exact gone title and no conflicting code prompt.
- Three cache TTL defaults and this deployment configuration are zero. If explicitly enabled, cache identity includes the actual selected extraction code under SHA-256; different code values cannot cross-cache. Cached results retain the original observation time. Website health decisions apply their own freshness, version, round and input guards.
- Logs contain fixed events and safe provider/status/reason/duration/cache metadata; they omit raw URL, extraction code, provider message/body, unknown provider codes, authorization and cookies. The response exposes only audited known providerCode values, never submitted credentials.

Synthetic tests prove these boundaries, not live-provider reliability or download completion. The 30 HTTP and 24 provider regression groups trace the prior evaluation's cases, with additional missing/duplicate/type/oversize/DNS/IPv6/TLS/redirect/log tests. Live tests require explicit sample authorization and a separate private sample file outside the repository. Record only opaque sample ID, expected/actual safe verdict, safe reason/providerCode/checkedAt and exact artifact hashes; never request URLs, passcodes or raw provider responses in logs or reports. This artifact's normal/abnormal Quark scope is covered by the two authorized samples; distinct failure subtypes use synthetic regression coverage. Website integration, full E10/E2E and production deployment are separate tasks.

The JSON duplicate guard uses the same Unicode case-fold equivalence as encoding/json v1, including nested keys. Unexpected listener startup failure exits nonzero for Restart=on-failure; normal SIGTERM exits zero. The bounded process regression is `python3 deployment/link-checker/tests/startup.py --manifest <native manifest> --report <new isolated report>`.
