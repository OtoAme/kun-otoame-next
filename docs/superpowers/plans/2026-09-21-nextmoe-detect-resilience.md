# NextMoe detect resilience

Date: 2026-09-21  
Branch: `fix/company-ingestion`  
Workspace: dump checkout (`kun-otoame-next-prod-dump`)  
Scope: dashboard **detect** (`POST /api/admin/company-merges/detect`) plus the shared NextMoe catalog client it uses. Apply / dismiss / `normalizeCompanyValue` / runtime resolver stay untouched.

Investigation (rounds 1–2) closed URL/auth/`include`, query encoding, collection `limit=20` as a batch-lane rule, 60/min rate limit, mixed vndb+bangumi refs, ClashX-as-522, missing User-Agent, and HTTP/2 as root causes. Do not reopen them.

---

## 1. Problem

NextMoe catalog origin behind Cloudflare is **bimodal**, not “our query is illegal”:

| When origin is warm                                                              | When origin is sick                                                                                                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 ref ~1–2s 200; 20 vndb refs + `include=companies,refs` ~1.2s 200, 68 companies | 3 vndb refs **22s 200** (twice); `/companies?ids=` **43s 200**; `/companies?refs=vndb:p473` **45s timeout** then later **734ms 200**; CF **522 ~19s SYN** |

Our client fights that distribution:

1. `AbortSignal.timeout(15s)` sits **inside** real 200s (22s, 43s) and **before** CF’s ~19s 522. Detect logs `timeout`; NextMoe’s app dashboard can still show a later 200 or nothing (edge 522 never hits origin). Matches “~11 successes, 0 5xx” vs our empty batches.
2. Three attempts with **200–400ms** backoff retry a sick origin. CF’s own 522 guidance is on the order of **120s**. Abort does not cancel origin work.
3. `fetchBatched` treats timeout as `items=0` and **splits** batches `>10`. Timeout is not “batch too fat”: 20 refs were _faster_ than 3. Split multiplies 15s hangs.
4. `/v2/catalog/companies?include=aliases` is **optional** for source-pair and flakier than works. Work `include=companies` already has `display_name`. VNDB `name ∪ original ∪ aliases` is the Tenky/テンキー bag. NextMoe Tenky aliases were empty even when works succeeded.

A logged detect (211 patches, 277 refs, batch=20) did: batches 1–2 timeout, 3–4 200 (14 items), batch 5 HTTP 520, then **empty NextMoe for the rest**; VNDB 209/209 still finished; `created=0 updated=32`. Layer 1 is fine. Layer 2 NextMoe is the stall.

---

## 2. Timeout pick: **12s**, one shot

Choose **12s fail-fast**, not 20s.

| Budget | What it catches                                         | Cost on a sick origin (2 consecutive failures, then breaker) |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------ |
| 12s    | Warm 200s (0.7–2s). Still hides 19s 522 and 22s 200.    | ~24s of NextMoe hang, then VNDB-only                         |
| 20s    | Can _observe_ CF 522 (~19s). Still misses 22s/43s 200s. | ~40s hang before breaker                                     |
| 45s    | Finds the 43s company 200. Unusable for detect UX.      | Forbidden (see §6)                                           |

22s/43s 200s are **out of scope for detect**. Waiting 20s does not harvest them and delays the breaker. Observing 522 is a debug nicety; we already know 15s aborts hide 522. Detect must stay interactive; VNDB is the source-pair backbone.

Document in client comments: 12s is a **detect UX bound**, not “NextMoe is specified at 12s”. Offline alias hydration (not this plan) may pass a longer `timeoutMs`.

---

## 3. Normative detect policy

### 3.1 VNDB first, fail-open

In `suggestSourcePairHits`:

1. Run **VNDB bags first** (`SOURCE_PAIR_VNDB_CONCURRENCY = 4`, `SOURCE_PAIR_VNDB_PAUSE_MS = 250` unchanged).
2. Then NextMoe works lookup, fail-open.
3. Union bags per patch as today. Conflicting external ids still skip. Layer 1 (suffix / name-variant) still runs **before** source-pair and must return even if layer 2 throws.

VNDB must not sit behind a NextMoe stall. The 90s detect that finished VNDB 209/209 after NextMoe emptied is the model; flipping order makes that the happy path.

### 3.2 NextMoe works lookup

- Lane unchanged: `GET /v2/catalog/works?refs=…&include=companies,refs&nsfw=true`.
- Batch size may stay `SOURCE_PAIR_NEXTMOE_BATCH = 20` (not a protocol limit; 20 was fine when origin was warm).
- **One attempt per batch.** Timeout **12s**.
- **Zero retries** on timeout and HTTP 520–527.
- Generic 5xx (500–519) on the detect path: also **one attempt** (detect must not sleep 200ms×3). 429 still belongs to the client (Retry-After); detect should not special-case it beyond fail-open.
- Pause between **successful** batches may stay `SOURCE_PAIR_NEXTMOE_PAUSE_MS = 1000`. Do not use that pause as a retry delay.

### 3.3 Circuit breaker (detect-run scoped)

Count **consecutive origin failures** on the NextMoe works loop:

- Origin failure = timeout, HTTP 520–527, or send error that is not auth/quota.  
  **Not** a 200 with `items=0` and `missing=[]` filled (legitimate unknown refs).
- After **one** origin failure: log, skip that batch, **continue later batches** (they can be 1s 200s; 20-ref 1.2s followed a 22s 3-ref 200).
- After **two consecutive** origin failures: **circuit-open NextMoe for the rest of this detect run**. Do not call works or companies again. Push a `notes[]` entry (Chinese, operator-facing), e.g. `NextMoe 连续失败，本轮已跳过，VNDB 结果保留`.
- A success **resets** the consecutive counter.
- Breaker is **this detect invocation only**. Do not set the shared client’s process-wide `disabled` on 520/timeout.

Auth (`401`/`403`) and `QUOTA_EXCEEDED` may still disable that client instance: those are credential/quota, not origin flap. Detect already fail-opens.

### 3.4 Do not split empty timeout batches

Delete the `batch.length > 10` recursive split in `fetchBatched` (or never treat origin-empty as “too fat”). Split-on-empty is the wrong diagnosis and multiplies hangs.

`fetchBatched`’s `try/catch` skip-and-continue stays useful **until** the breaker trips.

### 3.5 Do not disable the client process-wide on 520

Current uncommitted client already retries 520 without `disabled = true`. Keep that: **520/timeout must not set `disabled`**. Detect-layer breaker is what stops further _detect_ calls. Other callers of the same process (frozen planner, probe) must not inherit “detect gave up”.

### 3.6 Skip `/companies` alias hydration on detect

`loadNextmoeBagsByPatch` must **not** call `listNextmoeCompaniesByIds`.

Bags from NextMoe works: `display_name` on `work.companies[]` (plus `latin` only if it already arrived on that embed — it does not today). That is enough to pair same-script names on one work. Cross-script pairs (Tenky / テンキー) come from **VNDB**.

Optional later/offline (explicitly **not** this plan): `/companies?ids=&include=aliases` with timeout 45–60s, **one** retry after 60–120s, never 200ms, never on the detect POST.

---

## 4. Client vs detect-layer

Be precise. Two objects, two contracts.

### 4.1 Shared client (`app/api/company/nextmoe/client.ts`)

Used by detect, `scripts/probeNextmoeCompanySample.ts`, frozen planner.

| Kind                               | Attempts                                                                         | `disabled`              | Return                                    |
| ---------------------------------- | -------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------- |
| 2xx parsed list                    | 1                                                                                | no                      | list                                      |
| timeout / AbortError               | **1** (no retry)                                                                 | **no**                  | empty list + `originError: 'timeout'`     |
| 520–527                            | **1**                                                                            | **no**                  | empty list + `originError: 'unavailable'` |
| other 5xx                          | 1 for detect callers; default may stay 1 as well (do not restore 200ms×3 on 52x) | no                      | empty + `originError: 'server'`           |
| 429 `RATE_LIMITED`                 | up to 3, sleep `Retry-After`                                                     | no                      | retry then empty                          |
| 429 `QUOTA_EXCEEDED` / 401 / 403   | 1                                                                                | **yes** (this instance) | empty                                     |
| non-timeout send failure (DNS/TLS) | 1                                                                                | **yes**                 | empty                                     |

Required knobs (options on `createNextmoeCatalogClient`):

- `timeoutMs` default **12000**.
- `maxAttempts` default **1** for timeout/unavailable/server. 429 uses its own loop.

Required in-process field on the returned list (not NextMoe JSON, not Zod-from-wire):

```ts
originError?: 'timeout' | 'unavailable' | 'server' | 'auth' | 'quota' | 'rate-limited' | 'missing'
```

Detect reads `originError` to drive the breaker. `missing` from a 200 is not `originError`.

Logging (already partly added): **one line per attempt**, including successes:

```text
[nextmoe] GET /v2/catalog/works refs=N include=companies,refs attempt=1/1 -> 200|timeout|520 … ms items=… missing=… X-Request-ID=…
```

Do not log `Authorization` or the key.

### 4.2 Detect layer (`sourcePairSuggestions.ts` + `company-merges/service.ts`)

Owns: VNDB-first, skip companies, no split, consecutive-failure breaker, `notes[]`, progress events.

Does **not** set `client.disabled` on 520. After breaker open it simply stops calling the injected `listNextmoeWorksByRefs`.

Progress: keep `onProgress` `{ phase: 'vndb' | 'nextmoe', current, total, detail }`. Add `phase: 'nextmoe'` detail `breaker-open` when the breaker trips. Frontend SSE is **not** required for this fix (see §5).

`notes[]` examples (stable enough to toast):

- `NextMoe 连续失败，本轮已跳过，VNDB 结果保留`
- `NextMoe 未配置，仅用 VNDB`

---

## 5. Frontend

File: `components/dashboard/company-merges/DashboardCompanyMerges.tsx`.

**Minimum (required):** keep the elapsed-seconds timer while `detecting` (`detectElapsedSec` already ticks every 1s). Do not leave the operator staring at a static “检测中…” for 90s.

**Copy:** the helper text still says NextMoe-then-VNDB. Update to **VNDB first**, NextMoe best-effort, breaker skips the rest of NextMoe. Toast already appends `notes[]` — keep that.

**Cheap, optional:** if `onProgress` is already plumbed to the POST, do not invent SSE in this work. Streaming the detect response is **not a blocker**. A later PR may add SSE/chunked progress; resilience must land without it.

`kunFetchPost` has no default timeout — out of scope unless detect can now exceed the browser’s own limit. With breaker + VNDB-first, wall time should stay on the order of VNDB 209/4 + two 12s NextMoe failures worst case, plus layer 1.

---

## 6. What NOT to do

- Do **not** set detect timeout to 45s (or “just a bit more than 22s”) to harvest slow 200s.
- Do **not** restore 100–400ms backoff loops on timeout/520–527.
- Do **not** split empty batches to “recover partial data” after a timeout.
- Do **not** disable the shared client on 520 so that planner/probe in the same process die.
- Do **not** drop VNDB source-pair or lower VNDB concurrency as a NextMoe workaround.
- Do **not** guess romanization (`KONAMI` ↔ `テンキー`).
- Do **not** merge every company on one work.
- Do **not** change `normalizeCompanyValue`, apply/merge writers, Prisma schema, cron, LLM, or `.env`.
- Do **not** reopen closed hypotheses (URL format, encoding, `limit=20` pagination, 60/min, mixed refs, Clash as 522).
- Do **not** call live NextMoe from unit tests.

---

## 7. Tests

### 7.1 Client (`tests/unit/company-nextmoe-client.test.ts`)

Update the contract:

- Timeout: **one** fetch, empty list, `originError: 'timeout'`. Remove “retries a timeout and keeps the items from the successful attempt” **as a default-client test**. If `maxAttempts` remains configurable `>1`, keep one opt-in test that retries; detect will not use that.
- 522/520: **one** fetch, empty list, `originError: 'unavailable'`, **second** `listWorksByRefs` on the **same client** still calls fetch (not process-wide `disabled`).
- 401 / quota: still disable; second call does not fetch.
- 429 `RATE_LIMITED`: still sleeps Retry-After and retries (unchanged).
- URL string unchanged (still unencoded `refs=vndb:v2168,…&include=companies,refs&nsfw=true`).
- Default timeout: `AbortSignal.timeout` 12000 (assert via mock init `signal` if cheap; otherwise assert the constant and a timeout at 12s in a fake timer test).

### 7.2 Detect / source-pair (`tests/unit/company-source-pair.test.ts`)

- **No split on empty:** 20 keys, fetcher returns `{ items: [] }` (or `originError: 'timeout'`). `listNextmoeWorksByRefs` call count is **1**, not 1+2 halves.
- **Breaker:** two consecutive origin failures (`originError` or thrown timeout) → third batch **not** called. Inject 3+ batches of keys.
- **Single failure continues:** fail, then 200 with items → third call happens; consecutive counter reset.
- **520 does not disable later batches at the client:** if the test uses the real client with a fetch mock, 520 then 200 on the next batch succeeds. Detect-layer breaker still trips after **two** consecutive 520s (that is detect, not client).
- **VNDB-first:** with a NextMoe fetcher that hangs until a latch, VNDB `loadVndbDevelopers` is invoked **before** the latch is released (or: VNDB mock call order index `<` first NextMoe call). Tenky/テンキー still pairs from VNDB when NextMoe returns empty.
- **No companies hydration:** `listNextmoeCompaniesByIds` is **not** called even when works return company ids. Mebius source-pair that _only_ existed via NextMoe aliases may drop — acceptable; VNDB + display_name remain. Existing Cherrymochi non-merge still holds.
- Layer 1 still creates when source-pair fetchers throw (existing test).
- Fail-open: detect `created/updated` still returns; `notes` includes the breaker sentence when tripped.

Do not require “timeout then success on the **same** request” unless `maxAttempts > 1` is still a supported client option with an explicit test.

---

## 8. Implementation order (small PRs)

Code then a **separate** `docs(company): …` commit (Conventional Commits + skills sync). Do not mix ops module 03.

### PR A — client contract (no detect reorder yet)

- [ ] `timeoutMs` default 12000; no retry on timeout / 520–527; no `disabled` on those; `originError` on empty lists.
- [ ] Keep 429 Retry-After; keep auth/quota disable.
- [ ] Logging already present: keep one line per attempt (success + failure).
- [ ] Fix `company-nextmoe-client.test.ts` as in §7.1.
- [ ] `pnpm test tests/unit/company-nextmoe-client.test.ts` and `pnpm typecheck`.

### PR B — detect policy

- [ ] `suggestSourcePairHits`: VNDB loop **before** `loadNextmoeBagsByPatch`.
- [ ] `loadNextmoeBagsByPatch`: works only; **do not** call `listNextmoeCompaniesByIds`.
- [ ] `fetchBatched`: remove empty-split; count consecutive `originError`; stop calling after 2; reset on success; log `[company-merges:detect] nextmoe breaker open after N consecutive origin failures`.
- [ ] `collectSourcePairSuggestions` / detect service: pass `timeoutMs: 12000` if the client is constructed here; push breaker `notes[]`.
- [ ] Tests in §7.2.
- [ ] Dashboard copy: VNDB first (tiny, same PR is OK). Keep elapsed timer. No SSE.
- [ ] `pnpm test tests/unit/company-source-pair.test.ts tests/unit/company-merge-suggestions.test.ts tests/unit/company-nextmoe-client.test.ts` and `pnpm typecheck`.

### PR C — docs/skills only

- [ ] Point `docs/modules/*` / company-ingestion notes at this policy: NextMoe on detect is best-effort, 12s one-shot, breaker, no company alias fetch.
- [ ] Skills: mention fail-open + do not retry CF 52x with 200ms.
- [ ] Separate `docs(company): …` commit.

### Not in these PRs

- Offline `/companies` alias job.
- SSE progress.
- Changing batch size as a “fix”.
- Raising timeout to 20s/45s.
- Live NextMoe calls in CI.

---

## 9. Files

| File                                                             | Change                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app/api/company/nextmoe/client.ts`                              | 12s; one-shot on timeout/52x; `originError`; never `disabled` on those |
| `tests/unit/company-nextmoe-client.test.ts`                      | new contract                                                           |
| `app/api/company/identity/sourcePairSuggestions.ts`              | VNDB-first; no companies; no split; breaker                            |
| `app/api/admin/company-merges/service.ts`                        | notes; client options if constructed here                              |
| `types/api/companyMerges.ts`                                     | only if notes copy needs a comment                                     |
| `components/dashboard/company-merges/DashboardCompanyMerges.tsx` | helper text; keep timer                                                |
| `tests/unit/company-source-pair.test.ts`                         | breaker / no-split / no-companies / VNDB-first                         |
| docs/skills                                                      | PR C                                                                   |

---

## 10. Done when

- Detect on the dump: layer 1 still upserts; VNDB source-pair still proposes Tenky/テンキー; NextMoe never blocks VNDB; two origin failures skip remaining NextMoe in **seconds**, not 14×45s.
- A 520 on batch N does not zero batches N+1… unless it was the **second consecutive** origin failure.
- Unit tests in §7 pass; no live key in tests; no secrets in logs.
- Operator still sees elapsed seconds during 检测.
