import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn(), accept: vi.fn(), checkPermission: vi.fn(), fetch: vi.fn() }))
vi.mock('~/app/api/patch/resource/link-check/config', () => ({
  getLinkCheckerConfig: () => ({ endpoint: 'https://checker.example.test', apiKey: 'fixture-service-key' })
}))
vi.mock('~/prisma/index', () => ({ prisma: {} }))
vi.mock('~/app/api/patch/resource/linkHealthProjection', () => ({
  getLinkDisputeSources: vi.fn()
}))
vi.mock('~/app/api/patch/resource/link/service', () => ({
  loadHealthTarget: mocks.load,
  acceptLinkCheck: mocks.accept,
  healthBasis: (row: { id: number }) => ({
    patchId: 3,
    resourceId: 7,
    linkId: row.id,
    linkVersion: 2,
    evidenceRound: 1,
    health: 'ok',
    healthChangedAt: null
  }),
  assertHealthBasis: vi.fn(),
  requireLinkCheck: mocks.checkPermission,
  requireAcquisition: vi.fn(),
  submitLinkReport: vi.fn(),
  LinkHealthError: class extends Error {}
}))

import {
  manualLinkCheck,
  checkManagedLink
} from '~/app/api/patch/resource/link-check/service'

const basis = {
  patchId: 3,
  resourceId: 7,
  linkId: 21,
  linkVersion: 2,
  evidenceRound: 1,
  health: 'ok' as const,
  healthChangedAt: null
}
const actor = { uid: 1, role: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({
    provider: 'quark', status: 'unknown', reason: 'unsupported_provider', providerCode: '0',
    checkedAt: new Date().toISOString(), cached: false
  })))
  mocks.load.mockResolvedValue({
    id: 21,
    storage: 'user',
    content: 'https://pan.quark.cn/s/1fixture',
    code: 'fixture-code'
  })
  mocks.accept.mockResolvedValue({
    link: {
      latestCheck: {
        verdict: 'available',
        attemptedAt: '2026-10-16T01:00:00.000Z'
      }
    },
    changed: false,
    check: 'failed'
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('manual checker attempt response', () => {
  it('checks ordinary-user eligibility before the checker and accepts as the same actor', async () => {
    const ordinary = { uid: 88, role: 1 }
    await manualLinkCheck(basis, ordinary, {})
    expect(mocks.checkPermission).toHaveBeenCalledWith(expect.any(Object), ordinary)
    expect(mocks.accept).toHaveBeenCalledWith(
      basis, ordinary, {}, expect.any(Object), expect.any(Date), 'manual'
    )
  })

  it('returns a remotely disabled provider attempt separately from the latest stored observation', async () => {
    const result = await manualLinkCheck(basis, actor, {})
    expect(result).toMatchObject({
      check: 'failed',
      result: {
        provider: 'quark',
        verdict: 'unknown',
        reason: 'unsupported',
        failed: true,
        checkedAt: null,
        stale: false,
        attemptedAt: expect.any(String)
      },
      link: { latestCheck: { verdict: 'available' } }
    })
    const body = JSON.stringify(result)
    for (const secret of [
      'inputSignature',
      'requestId',
      'fixture-code',
      '/s/1fixture'
    ]) {
      expect(body).not.toContain(secret)
    }
  })

  it('retains the attempted verdict when a newer failure already owns the projection', async () => {
    mocks.load.mockResolvedValue({
      id: 21,
      storage: 'user',
      content: 'https://pan.quark.cn/s/fixture',
      code: ''
    })
    mocks.accept.mockResolvedValue({
      link: { latestCheck: { verdict: 'unknown', reason: 'timeout' } },
      changed: false,
      check: 'observed'
    })
    const now = new Date('2026-10-16T00:00:00.000Z')
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'quark',
          status: 'alive',
          reason: 'share_ok',
          providerCode: '0',
          checkedAt: now.toISOString(),
          cached: false
        })
      )
    )
    const { response } = await checkManagedLink(
      basis,
      actor,
      {},
      {
        now: () => now,
        config: {
          endpoint: 'https://checker.example.test',
          apiKey: 'fixture-service-key'
        },
        fetch
      }
    )
    expect(response).toMatchObject({
      check: 'observed',
      result: {
        verdict: 'available',
        reason: 'share_available',
        failed: false,
        checkedAt: now.toISOString(),
        attemptedAt: now.toISOString(),
        stale: false
      },
      link: { latestCheck: { verdict: 'unknown', reason: 'timeout' } }
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
