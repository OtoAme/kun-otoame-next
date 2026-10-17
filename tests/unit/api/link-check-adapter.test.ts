import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkLink,
  prepareLinkCheckInput
} from '~/app/api/patch/resource/link-check/checker'
import type { LinkCheckIdentity } from '~/types/api/linkHealth'

const requested = new Date('2026-10-09T10:00:00.000Z')
const completed = new Date(requested.getTime() + 1000)
const link = {
  storage: 'quark',
  content: 'https://pan.quark.cn/s/SYNTHETIC?pwd=URLCODE',
  code: 'SYN_CODE'
}
const config = { endpoint: 'http://127.0.0.1:6734', apiKey: 'SYN_SERVICE_KEY' }
const prepared = () => prepareLinkCheckInput(link)
const identity = (
  signature = prepared().inputSignature
): LinkCheckIdentity => ({
  requestId: '4f686045-3b8f-4c97-81f1-0c82276ba6d1',
  basis: {
    patchId: 1,
    resourceId: 2,
    linkId: 3,
    linkVersion: 4,
    evidenceRound: 5,
    health: 'suspect',
    healthChangedAt: null
  },
  inputSignature: signature,
  requestedAt: requested.toISOString()
})
const wire = (overrides: Record<string, unknown> = {}) => ({
  provider: 'quark',
  status: 'alive',
  reason: 'share_ok',
  providerCode: '0',
  checkedAt: requested.toISOString(),
  cached: false,
  ...overrides
})
const response = (value = wire()) =>
  new Response(JSON.stringify(value), { status: 200 })
const run = (value = wire(), id = identity()) => {
  const fetch = vi.fn().mockResolvedValue(response(value))
  return {
    fetch,
    result: checkLink(id, prepared(), { config, now: () => completed, fetch })
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pure checker input preparation', () => {
  it('binds exactly the frozen JSON identity, chooses saved code and removes incidental credentials from the share URL', () => {
    const value = prepared()
    expect(value).toEqual({
      provider: 'quark',
      url: 'https://pan.quark.cn/s/SYNTHETIC',
      passcode: 'SYN_CODE',
      inputSignature: createHash('sha256')
        .update(
          JSON.stringify([link.storage, link.content, 'quark', link.code])
        )
        .digest('hex')
    })
    expect(
      prepareLinkCheckInput({ ...link, code: 'OTHER_CODE' }).inputSignature
    ).not.toBe(value.inputSignature)
    expect(
      prepareLinkCheckInput({ ...link, storage: 'different' }).inputSignature
    ).not.toBe(value.inputSignature)
  })
  it('uses existing URL or explicit extraction/access code, never an unzip-password field/label', () => {
    expect(prepareLinkCheckInput({ ...link, code: '' }).passcode).toBe(
      'URLCODE'
    )
    expect(
      prepareLinkCheckInput({
        ...link,
        content: '链接 https://pan.quark.cn/s/SYN 提取码：ABCD',
        code: ''
      }).passcode
    ).toBe('ABCD')
    const value = prepareLinkCheckInput({
      ...link,
      content: 'https://pan.quark.cn/s/SYN 解压密码：SYN_UNZIP',
      code: '',
      password: 'SYN_UNZIP'
    } as typeof link)
    expect(value.passcode).toBeUndefined()
  })
  it('recognizes candidates but Caiyun never includes or signs a passcode', () => {
    for (const [url, provider] of [
      ['https://drive.uc.cn/s/SYN', 'uc'],
      ['https://pan.baidu.com/s/1SYN', 'baidu'],
      ['https://www.123pan.com/s/SYN', 'pan123']
    ] as const)
      expect(prepareLinkCheckInput({ ...link, content: url }).provider).toBe(
        provider
      )
    const caiyun = prepareLinkCheckInput({
      ...link,
      content: 'https://caiyun.139.com/front/#/detail?linkID=SYN&pwd=SECRET'
    })
    expect(caiyun.provider).toBe('caiyun')
    expect(caiyun.passcode).toBeUndefined()
    expect(caiyun.url).not.toContain('SECRET')
    expect(
      prepareLinkCheckInput({
        ...link,
        content: 'https://caiyun.139.com/m/i?SYN',
        code: 'FIRST'
      }).inputSignature
    ).toBe(
      prepareLinkCheckInput({
        ...link,
        content: 'https://caiyun.139.com/m/i?SYN',
        code: 'SECOND'
      }).inputSignature
    )
  })
  it.each([
    'https://pan.quark.cn:8443/s/SYN',
    'https://SYN:SYN@pan.quark.cn/s/SYN',
    'https://pan.quark.cn.evil.invalid/s/SYN',
    'https://pan.quark.cn./s/SYN',
    'https://arbitrary.123pan.com/s/SYN',
    'magnet:?xt=SYN'
  ])('does not treat %s as an approved share', (content) => {
    expect(prepareLinkCheckInput({ ...link, content }).provider).toBeNull()
  })
})

describe('single trusted checker request', () => {
  it('uses fixed single endpoint/Bearer/no cookies/cache/redirects and preserves private request identity', async () => {
    const { fetch, result } = run()
    const snapshot = await result
    expect(snapshot).toMatchObject({
      ...identity(),
      verdict: 'available',
      reason: 'share_available',
      failed: false,
      checkedAt: requested.toISOString(),
      completedAt: completed.toISOString(),
      cached: false
    })
    const [url, request] = fetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:6734/v1/check')
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: 'Bearer SYN_SERVICE_KEY' }
    })
    expect(JSON.parse(request.body)).toEqual({
      url: expect.stringMatching(
        /^https:\/\/pan\.quark\.cn\/s\/SYNTHETIC\?otoame_check=[a-f0-9]{64}$/
      ),
      passcode: 'SYN_CODE'
    })
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not send unsupported/unqualified providers or an identity with mismatched signature', async () => {
    const fetch = vi.fn()
    for (const url of ['https://unsupported.invalid/SYN']) {
      const value = prepareLinkCheckInput({ ...link, content: url })
      expect(
        await checkLink(identity(value.inputSignature), value, {
          config,
          now: () => completed,
          fetch
        })
      ).toMatchObject({
        verdict: 'unknown',
        reason: 'unsupported',
        failed: true,
        checkedAt: null
      })
    }
    expect(
      await checkLink(identity('0'.repeat(64)), prepared(), {
        config,
        now: () => completed,
        fetch
      })
    ).toMatchObject({
      verdict: 'unknown',
      reason: 'untrusted_result',
      checkedAt: null
    })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    'http://checker.example',
    'https://user:key@checker.example',
    'https://checker.example/batch',
    'https://checker.example/v1/check/batch',
    'https://checker.example/?url=SYN',
    'https://checker.example/#fragment',
    'not a URL'
  ])('rejects unsafe config %s before fetch', async (endpoint) => {
    const fetch = vi.fn()
    expect(
      await checkLink(identity(), prepared(), {
        config: { ...config, endpoint },
        now: () => completed,
        fetch
      })
    ).toMatchObject({
      verdict: 'unknown',
      reason: 'unavailable',
      checkedAt: null
    })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('accepts private HTTPS/full-path service config, rejects missing/injected auth without I/O', async () => {
    const fetch = vi.fn().mockResolvedValue(response())
    expect(
      (
        await checkLink(identity(), prepared(), {
          config: { ...config, endpoint: 'https://checker.private/v1/check' },
          now: () => completed,
          fetch
        })
      ).verdict
    ).toBe('available')
    fetch.mockClear()
    for (const apiKey of ['', 'key\r\nSYN_HEADER', 'key with space'])
      expect(
        (
          await checkLink(identity(), prepared(), {
            config: { ...config, apiKey },
            now: () => completed,
            fetch
          })
        ).failed
      ).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('qualified tuple and observation validation', () => {
  it.each([
    ['41004', 'share_not_found', 'share_deleted'],
    ['41006', 'share_not_found', 'share_deleted'],
    ['41012', 'share_not_found', 'share_cancelled'],
    ['41011', 'share_expired', 'share_expired']
  ])(
    'maps only qualified fresh %s to %s',
    async (providerCode, reason, safeReason) => {
      expect(
        await run(wire({ status: 'dead', providerCode, reason })).result
      ).toMatchObject({
        verdict: 'broken',
        reason: safeReason,
        failed: false,
        checkedAt: requested.toISOString()
      })
    }
  )
  it.each([
    ['share_blocked', '41010'],
    ['share_blocked', '41031'],
    ['share_blocked', '0/partial_violation'],
    ['passcode_required', '41008']
  ])('retains observed uncertainty for %s/%s', async (reason, providerCode) => {
    expect(
      await run(wire({ status: 'unknown', reason, providerCode })).result
    ).toMatchObject({
      verdict: 'unknown',
      reason: 'access_unverified',
      failed: false,
      checkedAt: requested.toISOString()
    })
  })
  it.each([
    { provider: 'uc' },
    { status: 'alive', providerCode: '41008' },
    { reason: 'SYN_RAW_MESSAGE' },
    { providerCode: undefined }
  ])('rejects mismatched/stale/unreviewed tuple %j', async (override) => {
    expect(await run(wire(override)).result).toMatchObject({
      verdict: 'unknown',
      failed: true,
      checkedAt: null
    })
  })
  it.each([
    'invalid date',
    '2026-02-30T10:00:00Z',
    '2026-10-09T09:59:54.999Z',
    '2026-10-09T10:00:06.001Z'
  ])('fails invalid/outside-window time %s', async (checkedAt) => {
    expect(await run(wire({ checkedAt })).result).toMatchObject({
      verdict: 'unknown',
      failed: true,
      checkedAt: null
    })
  })
  it('normalizes real RFC3339 offset/nanoseconds and checks both inclusive skew edges and the handling base', async () => {
    expect(
      (
        await run(wire({ checkedAt: '2026-10-09T18:00:00.123456789+08:00' }))
          .result
      ).checkedAt
    ).toBe('2026-10-09T10:00:00.123Z')
    for (const checkedAt of ['2026-10-09T09:59:55Z', '2026-10-09T10:00:06Z'])
      expect((await run(wire({ checkedAt })).result).failed).toBe(false)
    const id = identity()
    id.basis.healthChangedAt = '2026-10-09T10:00:00.001Z'
    expect(await run(wire(), id).result).toMatchObject({
      failed: true,
      checkedAt: null
    })
  })
  it.each([401, 403, 429, 500, 503])(
    'fails service HTTP %s without trusting a body tuple',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            wire({
              status: 'dead',
              reason: 'share_not_found',
              providerCode: '41004'
            })
          ),
          { status }
        )
      )
      expect(
        await checkLink(identity(), prepared(), {
          config,
          now: () => completed,
          fetch
        })
      ).toMatchObject({
        failed: true,
        checkedAt: null,
        reason: status === 429 ? 'rate_limited' : 'unavailable'
      })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )
  it('rejects redirects and never retries thrown private network errors or logs input', async () => {
    const log = vi.spyOn(console, 'log')
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    const fetch = vi
      .fn()
      .mockRejectedValue(
        new Error('SYN_SERVICE_KEY SYN_CODE https://pan.quark.cn/s/PRIVATE')
      )
    const failed = await checkLink(identity(), prepared(), {
      config,
      now: () => completed,
      fetch
    })
    expect(JSON.stringify(failed)).not.toMatch(
      /SYN_SERVICE_KEY|SYN_CODE|PRIVATE|https:\/\//
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    fetch.mockResolvedValueOnce(
      new Response('', {
        status: 302,
        headers: { Location: 'http://127.0.0.1/PRIVATE' }
      })
    )
    expect(
      (
        await checkLink(identity(), prepared(), {
          config,
          now: () => completed,
          fetch
        })
      ).reason
    ).toBe('untrusted_result')
  })
})

describe('bounded response and complete request budget', () => {
  it.each([
    'null',
    '[]',
    '{',
    JSON.stringify({ ...wire(), rawUrl: 'PRIVATE' }),
    '{"provider":"quark","status":"unknown","status":"alive","reason":"share_ok","providerCode":"0","checkedAt":"2026-10-09T10:00:00Z","cached":false}'
  ])('rejects strict malformed/extra/duplicate response %s', async (body) => {
    const fetch = vi.fn().mockResolvedValue(new Response(body))
    expect(
      await checkLink(identity(), prepared(), {
        config,
        now: () => completed,
        fetch
      })
    ).toMatchObject({
      reason: 'invalid_response',
      failed: true,
      checkedAt: null
    })
  })
  it('enforces bytes for declared and streamed body sizes, while accepting an exact 8KiB valid body', async () => {
    const valid = JSON.stringify(wire())
    for (const bytes of [8192, 8193]) {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(valid + ' '.repeat(bytes - valid.length))
        )
      const result = await checkLink(identity(), prepared(), {
        config,
        now: () => completed,
        fetch
      })
      expect(result.failed).toBe(bytes > 8192)
    }
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(valid, { headers: { 'Content-Length': '8193' } })
      )
    expect(
      (
        await checkLink(identity(), prepared(), {
          config,
          now: () => completed,
          fetch
        })
      ).reason
    ).toBe('invalid_response')
  })
  it('times out a hung fetch at 15s, including time elapsed before entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(requested)
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {})
    )
    const result = checkLink(identity(), prepared(), { config, fetch })
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toMatchObject({
      reason: 'timeout',
      failed: true,
      checkedAt: null
    })
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    fetch.mockClear()
    vi.setSystemTime(new Date(requested.getTime() + 15000))
    expect(
      (await checkLink(identity(), prepared(), { config, fetch })).reason
    ).toBe('timeout')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps the body read within the same deadline and cancels a stalled stream', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(requested)
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start() {}, cancel })
    const fetch = vi.fn().mockResolvedValue(new Response(body))
    const result = checkLink(identity(), prepared(), { config, fetch })
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toMatchObject({
      failed: true,
      reason: 'timeout',
      checkedAt: null
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
