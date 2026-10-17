import { describe, expect, it, vi } from 'vitest'
import {
  checkLink,
  prepareLinkCheckInput
} from '~/app/api/patch/resource/link-check/checker'
import { linkCheckSnapshotSchema } from '~/validations/linkHealth'
import type {
  LinkCheckIdentity,
  LinkCheckProvider
} from '~/types/api/linkHealth'

const now = new Date('2026-10-17T02:27:22.141Z')
const urls: Record<LinkCheckProvider, string> = {
  quark: 'https://pan.quark.cn/s/SYN',
  uc: 'https://drive.uc.cn/s/SYN',
  baidu: 'https://pan.baidu.com/s/1SYN',
  caiyun: 'https://caiyun.139.com/m/i?SYN',
  pan123: 'https://www.123pan.com/s/SYN'
}
const config = { endpoint: 'https://checker.example.test', apiKey: 'SYN_KEY' }
const run = async (
  provider: LinkCheckProvider,
  overrides: Record<string, unknown> = {},
  content = urls[provider],
  code = '',
  basisOverrides: Partial<LinkCheckIdentity['basis']> = {},
  requested = now
) => {
  const prepared = prepareLinkCheckInput({ storage: 'user', content, code })
  const identity: LinkCheckIdentity = {
    requestId: '4f686045-3b8f-4c97-81f1-0c82276ba6d1',
    inputSignature: prepared.inputSignature,
    requestedAt: requested.toISOString(),
    basis: {
      patchId: 1,
      resourceId: 2,
      linkId: 3,
      linkVersion: 1,
      evidenceRound: 0,
      health: 'ok',
      healthChangedAt: null,
      ...basisOverrides
    }
  }
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        provider,
        status: 'alive',
        reason: 'share_ok',
        providerCode: '0',
        checkedAt: requested.toISOString(),
        cached: false,
        ...overrides
      })
    )
  )
  const snapshot = await checkLink(identity, prepared, {
    config,
    now: () => requested,
    fetch
  })
  const body = fetch.mock.calls[0]?.[1]?.body
  return { snapshot, fetch, request: body ? JSON.parse(body) : null }
}

describe('LLC supported providers', () => {
  it.each(Object.keys(urls) as LinkCheckProvider[])(
    'checks %s and accepts its successful result',
    async (provider) => {
      const { snapshot, request, fetch } = await run(
        provider,
        {},
        urls[provider],
        ' SAVED '
      )
      expect(snapshot).toMatchObject({
        provider,
        verdict: 'available',
        failed: false
      })
      expect(linkCheckSnapshotSchema.safeParse(snapshot).success).toBe(true)
      expect(request.passcode).toBe(provider === 'caiyun' ? undefined : 'SAVED')
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['quark', 'share_blocked', '41010', 'share_blocked'],
    ['quark', 'share_blocked', '41031', 'share_blocked'],
    ['uc', 'share_blocked', '41010', 'share_blocked'],
    ['uc', 'share_not_found', '41004', 'share_deleted'],
    ['uc', 'share_not_found', '41006', 'share_deleted'],
    ['uc', 'share_not_found', '41012', 'share_cancelled'],
    ['uc', 'share_expired', '41011', 'share_expired'],
    ['baidu', 'share_not_found', '-21', 'share_deleted'],
    ['baidu', 'share_not_found', '-9/page', 'share_deleted'],
    ['caiyun', 'share_not_found', '200000727', 'share_deleted'],
    ['pan123', 'share_not_found', '5103', 'share_deleted']
  ] as const)(
    'maps %s %s/%s to a broken observation',
    async (provider, reason, providerCode, safeReason) => {
      const { snapshot } = await run(provider, {
        status: 'dead',
        reason,
        providerCode
      })
      expect(snapshot).toMatchObject({
        verdict: 'broken',
        reason: safeReason,
        failed: false
      })
      expect(linkCheckSnapshotSchema.safeParse(snapshot).success).toBe(true)
    }
  )

  it.each([
    ['quark', 'unknown', 'share_blocked', '0/partial_violation'],
    ['uc', 'unknown', 'passcode_required', '41008'],
    ['baidu', 'unknown', 'passcode_required', '-9'],
    ['baidu', 'alive', 'share_ok', '-9/page'],
    ['caiyun', 'alive', 'share_ok', '9188'],
    ['pan123', 'alive', 'share_ok', '5103']
  ] as const)(
    'keeps %s access uncertainty separate from availability',
    async (provider, status, reason, providerCode) => {
      const { snapshot } = await run(provider, { status, reason, providerCode })
      expect(snapshot).toMatchObject({
        verdict: 'unknown',
        reason: 'access_unverified',
        failed: false,
        checkedAt: now.toISOString()
      })
    }
  )

  it.each([
    ['baidu', 'timeout', '-9', 'timeout'],
    ['baidu', 'network_error', '-9', 'unavailable'],
    ['pan123', 'unparseable_response', '5103', 'invalid_response'],
    ['caiyun', 'unparseable_response', 'NEW_CODE', 'invalid_response'],
    ['uc', 'rate_limited', undefined, 'rate_limited'],
    ['quark', 'captcha_required', undefined, 'access_unverified']
  ] as const)(
    'handles %s %s as a safe failure',
    async (provider, reason, providerCode, safeReason) => {
      expect(
        (await run(provider, { status: 'unknown', reason, providerCode }))
          .snapshot
      ).toMatchObject({
        verdict: 'unknown',
        reason: safeReason,
        failed: true,
        checkedAt: null
      })
    }
  )

  it('reports a remotely disabled provider as unsupported and rejects mismatched providers/codes', async () => {
    expect(
      (
        await run('uc', {
          provider: 'unknown',
          status: 'unknown',
          reason: 'unsupported_provider',
          providerCode: undefined
        })
      ).snapshot
    ).toMatchObject({ reason: 'unsupported', provider: 'uc', failed: true })
    for (const overrides of [
      { provider: 'quark' },
      { status: 'dead', reason: 'share_not_found', providerCode: '41004' },
      { status: 'dead', reason: 'share_blocked', providerCode: 'NEW' }
    ]) {
      expect((await run('baidu', overrides)).snapshot).toMatchObject({
        verdict: 'unknown',
        reason: 'untrusted_result',
        failed: true
      })
    }
  })
})

describe('LLC input and cache compatibility', () => {
  it.each([
    'https://caiyun.139.com/m/i?SYN',
    'https://yun.139.com/m/i?SYN&pwd=SECRET',
    'https://caiyun.139.com/front/#/detail?linkID=SYN&pwd=SECRET',
    'https://yun.139.com/w?linkID=SYN&password=SECRET'
  ])('retains the Caiyun share identity from %s', async (content) => {
    const { request } = await run('caiyun', {}, content, 'UNUSED')
    const url = new URL(request.url)
    expect(url.searchParams.get('linkID')).toBe('SYN')
    expect(url.hash).toBe('')
    expect(request).not.toHaveProperty('passcode')
    expect(request.url).not.toMatch(/SECRET|UNUSED/)
  })

  it.each([
    'https://123pan.cn/123pan/SYN',
    'https://share.123pan.cn/123pan/SYN',
    'https://www.123912.cn/s/SYN',
    'http://123684.com/s/SYN'
  ])('sends supported 123 aliases over HTTPS: %s', async (content) => {
    const { request, snapshot } = await run('pan123', {}, content)
    expect(snapshot.verdict).toBe('available')
    expect(new URL(request.url).protocol).toBe('https:')
  })

  it('isolates LLC cache entries by extraction code, handling basis and time window', async () => {
    const first = (await run('quark', {}, urls.quark, 'FIRST')).request.url
    expect((await run('quark', {}, urls.quark, 'FIRST')).request.url).toBe(
      first
    )
    expect((await run('quark', {}, urls.quark, 'SECOND')).request.url).not.toBe(
      first
    )
    expect(
      (await run('quark', {}, urls.quark, 'FIRST', { evidenceRound: 1 }))
        .request.url
    ).not.toBe(first)
    expect(
      (
        await run(
          'quark',
          {},
          urls.quark,
          'FIRST',
          {},
          new Date(now.getTime() + 300000)
        )
      ).request.url
    ).not.toBe(first)
    expect(first).not.toContain('FIRST')
  })

  it('accepts a recent cached 41010 with its original observation time', async () => {
    const checkedAt = new Date(now.getTime() - 60000).toISOString()
    const { snapshot } = await run('quark', {
      status: 'dead',
      reason: 'share_blocked',
      providerCode: '41010',
      cached: true,
      checkedAt
    })
    expect(snapshot).toMatchObject({
      verdict: 'broken',
      reason: 'share_blocked',
      cached: true,
      checkedAt,
      failed: false
    })
    expect(linkCheckSnapshotSchema.safeParse(snapshot).success).toBe(true)
  })

  it('rejects cached evidence older than five minutes or the handling basis, including persisted snapshots', async () => {
    for (const [age, basis] of [
      [300001, {}],
      [
        60000,
        { healthChangedAt: new Date(now.getTime() - 30000).toISOString() }
      ]
    ] as const) {
      const checkedAt = new Date(now.getTime() - age).toISOString()
      const { snapshot } = await run(
        'quark',
        { cached: true, checkedAt },
        urls.quark,
        '',
        basis
      )
      expect(snapshot).toMatchObject({
        verdict: 'unknown',
        reason: 'untrusted_result',
        failed: true,
        checkedAt: null
      })
      expect(
        linkCheckSnapshotSchema.safeParse({
          ...snapshot,
          verdict: 'available',
          reason: 'share_available',
          failed: false,
          cached: true,
          checkedAt
        }).success
      ).toBe(false)
    }
  })
})
