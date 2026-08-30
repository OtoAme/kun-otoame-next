import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {}
  return {
    patch: { findUnique: vi.fn() },
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    ),
    _tx: tx
  }
})
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const invalidateCompanyCachesMock = vi.hoisted(() => vi.fn())
const invalidatePatchContentCacheMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: invalidateCompanyCachesMock,
  invalidatePatchContentCache: invalidatePatchContentCacheMock
}))

const applyCompanyResolutionMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/company/identity/resolver', () => ({
  applyCompanyResolution: applyCompanyResolutionMock
}))

import { ensurePatchCompanyFromDlsite } from '~/app/api/edit/dlsite'

describe('DLSite company identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$transaction.mockImplementation((callback) =>
      callback(prismaMocks._tx)
    )
    applyCompanyResolutionMock.mockResolvedValue({
      companyIds: [7],
      created: 1,
      insertedRelationIds: [7],
      diagnostics: []
    })
    prismaMocks.patch.findUnique.mockResolvedValue({ unique_id: 'patch-10' })
    invalidateCompanyCachesMock.mockResolvedValue(undefined)
    invalidatePatchContentCacheMock.mockResolvedValue(undefined)
  })

  it('routes the circle through the shared resolver before relating it', async () => {
    await ensurePatchCompanyFromDlsite(
      10,
      'RJ123',
      100,
      'Circle',
      'https://example.test/circle'
    )

    expect(applyCompanyResolutionMock).toHaveBeenCalledWith(
      prismaMocks._tx,
      10,
      [
        {
          trust: 'unverified',
          candidate: expect.objectContaining({
            source: 'dlsite',
            externalId: '',
            name: 'Circle',
            roles: ['circle'],
            entityType: 'amateur_group',
            externalUrls: ['https://example.test/circle'],
            sourceWebsites: ['https://example.test/circle']
          })
        }
      ],
      100
    )
    expect(invalidateCompanyCachesMock).toHaveBeenCalledOnce()
    expect(invalidatePatchContentCacheMock).toHaveBeenCalledWith('patch-10')
  })
})
