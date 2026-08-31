import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_company: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createManyAndReturn: vi.fn(),
      update: vi.fn()
    },
    patch_company_name_identity: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn()
    },
    $queryRaw: vi.fn()
  }

  return {
    patch: {
      findUnique: vi.fn()
    },
    $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const fetchVndbVnMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/arnebiae/vndb', () => ({
  fetchVndbVn: fetchVndbVnMock
}))

const cacheMocks = vi.hoisted(() => ({
  invalidateCompanyCaches: vi.fn(),
  invalidatePatchContentCache: vi.fn()
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: cacheMocks.invalidateCompanyCaches,
  invalidatePatchContentCache: cacheMocks.invalidatePatchContentCache
}))

const resolverMocks = vi.hoisted(() => ({
  applyCompanyResolution: vi.fn()
}))
vi.mock('~/app/api/company/identity/resolver', () => ({
  applyCompanyResolution: resolverMocks.applyCompanyResolution,
  CompanyResolutionAmbiguityError: class CompanyResolutionAmbiguityError extends Error {}
}))

import { ensurePatchCompaniesFromVNDB } from '~/app/api/edit/fetchCompanies'

describe('ensurePatchCompaniesFromVNDB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch.findUnique.mockReset()
    prismaMocks._tx.patch_company.findMany.mockReset()
    prismaMocks._tx.patch_company.createManyAndReturn.mockReset()
    prismaMocks._tx.patch_company.findUnique.mockReset()
    prismaMocks._tx.patch_company.update.mockReset()
    prismaMocks._tx.patch_company_name_identity.createMany.mockReset()
    prismaMocks._tx.patch_company_name_identity.deleteMany.mockReset()
    prismaMocks._tx.patch_company_name_identity.update.mockReset()
    prismaMocks._tx.$queryRaw.mockReset()
    fetchVndbVnMock.mockReset()
    resolverMocks.applyCompanyResolution.mockReset()
    cacheMocks.invalidateCompanyCaches.mockReset()
    cacheMocks.invalidatePatchContentCache.mockReset()
    prismaMocks.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMocks._tx) => Promise<unknown>) =>
        fn(prismaMocks._tx)
    )
    fetchVndbVnMock.mockResolvedValue({
      results: [
        {
          developers: [
            {
              id: 'p1',
              name: 'VNDB Studio',
              original: 'Original Studio',
              aliases: ['Studio Alias'],
              lang: 'ja',
              type: 'co',
              description: 'Visual novel developer.',
              extlinks: [{ url: 'https://studio.example' }]
            }
          ]
        }
      ]
    })
    prismaMocks._tx.patch_company.createManyAndReturn.mockResolvedValue([
      { id: 7 }
    ])
    prismaMocks._tx.patch_company.findUnique.mockResolvedValue({
      name: 'VNDB Studio',
      alias: [],
      normalized_name: null,
      introduction: '',
      primary_language: [],
      official_website: [],
      parent_brand: [],
      name_identities: []
    })
    prismaMocks._tx.patch_company.update.mockResolvedValue({})
    prismaMocks._tx.patch_company_name_identity.createMany.mockResolvedValue({
      count: 1
    })
    prismaMocks._tx.patch_company_name_identity.deleteMany.mockResolvedValue({
      count: 0
    })
    prismaMocks._tx.patch_company_name_identity.update.mockResolvedValue({})
    prismaMocks._tx.$queryRaw.mockResolvedValue([{ company_id: 7 }])
    prismaMocks.patch.findUnique.mockResolvedValue({ unique_id: 'abc12345' })
    cacheMocks.invalidateCompanyCaches.mockResolvedValue(undefined)
    cacheMocks.invalidatePatchContentCache.mockResolvedValue(undefined)
    resolverMocks.applyCompanyResolution.mockResolvedValue({
      companyIds: [7],
      created: 0,
      insertedRelationIds: [],
      diagnostics: []
    })
    delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
  })

  afterEach(() => {
    delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
  })

  it('maps VNDB producer names to existing company aliases', async () => {
    prismaMocks._tx.patch_company.findMany.mockResolvedValueOnce([
      {
        id: 7,
        name: 'Existing Studio',
        alias: ['VNDB Studio'],
        normalized_name: 'existing studio',
        introduction: '',
        primary_language: [],
        official_website: [],
        parent_brand: []
      }
    ])

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 0, resolved: 1, related: 1 })
    expect(
      prismaMocks._tx.patch_company.createManyAndReturn
    ).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_company.update).toHaveBeenCalled()
    expect(
      prismaMocks._tx.patch_company_name_identity.createMany
    ).toHaveBeenCalled()
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalledOnce()
  })

  it('invalidates the patch detail cache when VNDB fetch adds companies', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7, name: 'VNDB Studio', alias: [] }])
    prismaMocks._tx.patch_company.findUnique.mockResolvedValue({
      name: 'VNDB Studio',
      alias: ['Original Studio', 'Studio Alias'],
      normalized_name: 'vndb studio',
      name_identities: []
    })

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 1, resolved: 1, related: 1 })
    expect(prismaMocks.patch.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { unique_id: true }
    })
    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalledOnce()
    expect(
      prismaMocks._tx.patch_company.createManyAndReturn
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            introduction: 'Visual novel developer.',
            normalized_name: 'vndb studio'
          })
        ]
      })
    )
    expect(
      prismaMocks._tx.patch_company_name_identity.createMany
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          kind: 'alias',
          origin: 'authoritative',
          normalized_value: 'original studio'
        }),
        expect.objectContaining({
          kind: 'alias',
          origin: 'authoritative',
          normalized_value: 'studio alias'
        })
      ]),
      skipDuplicates: true
    })
  })

  it('uses the identity resolver for manual VNDB refresh when enabled', async () => {
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = 'true'

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 0, resolved: 1, related: 0 })
    expect(resolverMocks.applyCompanyResolution).toHaveBeenCalledOnce()
    expect(
      prismaMocks._tx.patch_company.createManyAndReturn
    ).not.toHaveBeenCalled()
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalledOnce()
    expect(cacheMocks.invalidatePatchContentCache).not.toHaveBeenCalled()
  })

  it('reports zero new relations when a VNDB company was already related', async () => {
    prismaMocks._tx.patch_company.findMany.mockResolvedValueOnce([
      {
        id: 7,
        name: 'VNDB Studio',
        alias: [],
        normalized_name: 'vndb studio',
        introduction: 'Visual novel developer.',
        primary_language: ['ja'],
        official_website: ['https://studio.example'],
        parent_brand: []
      }
    ])
    prismaMocks._tx.patch_company.findUnique
      .mockResolvedValueOnce({
        id: 7,
        name: 'VNDB Studio',
        alias: [],
        normalized_name: 'vndb studio',
        introduction: 'Visual novel developer.',
        primary_language: ['ja'],
        official_website: ['https://studio.example'],
        parent_brand: []
      })
      .mockResolvedValue({
        name: 'VNDB Studio',
        alias: ['Original Studio', 'Studio Alias'],
        normalized_name: 'vndb studio',
        name_identities: []
      })
    prismaMocks._tx.$queryRaw
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([])

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 0, resolved: 1, related: 0 })
  })

  it('keeps the committed result when post-commit cache invalidation fails', async () => {
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = 'true'
    resolverMocks.applyCompanyResolution.mockResolvedValueOnce({
      companyIds: [7],
      created: 0,
      insertedRelationIds: [7],
      diagnostics: []
    })
    cacheMocks.invalidateCompanyCaches.mockRejectedValueOnce(
      new Error('redis unavailable')
    )
    cacheMocks.invalidatePatchContentCache.mockRejectedValueOnce(
      new Error('redis unavailable')
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 0, resolved: 1, related: 1 })
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to invalidate caches after ensuring companies',
      expect.objectContaining({ patchId: 10 })
    )
    errorSpy.mockRestore()
  })
})
