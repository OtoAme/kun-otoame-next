import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_company: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn()
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

import { ensurePatchCompaniesFromVNDB } from '~/app/api/edit/fetchCompanies'

describe('ensurePatchCompaniesFromVNDB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch.findUnique.mockReset()
    prismaMocks._tx.patch_company.findMany.mockReset()
    prismaMocks._tx.patch_company.createMany.mockReset()
    prismaMocks._tx.patch_company.updateMany.mockReset()
    prismaMocks._tx.$queryRaw.mockReset()
    fetchVndbVnMock.mockReset()
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
              name: 'VNDB Studio',
              original: 'Original Studio',
              aliases: ['Studio Alias'],
              lang: 'ja',
              type: 'co',
              extlinks: [{ url: 'https://studio.example' }]
            }
          ]
        }
      ]
    })
    prismaMocks._tx.patch_company.createMany.mockResolvedValue({ count: 1 })
    prismaMocks._tx.patch_company.updateMany.mockResolvedValue({ count: 1 })
    prismaMocks._tx.$queryRaw.mockResolvedValue([{ company_id: 7 }])
    prismaMocks.patch.findUnique.mockResolvedValue({ unique_id: 'abc12345' })
    cacheMocks.invalidateCompanyCaches.mockResolvedValue(undefined)
    cacheMocks.invalidatePatchContentCache.mockResolvedValue(undefined)
  })

  it('maps VNDB producer names to existing company aliases', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([
        { id: 7, name: 'Existing Studio', alias: ['VNDB Studio'] }
      ])
      .mockResolvedValueOnce([
        { id: 7, name: 'Existing Studio', alias: ['VNDB Studio'] }
      ])

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 0, related: 1 })
    expect(prismaMocks._tx.patch_company.createMany).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      data: { count: { increment: 1 } }
    })
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalledOnce()
  })

  it('invalidates the patch detail cache when VNDB fetch adds companies', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7, name: 'VNDB Studio', alias: [] }])

    const result = await ensurePatchCompaniesFromVNDB(10, 'v123', 100)

    expect(result).toEqual({ ensured: 1, related: 1 })
    expect(prismaMocks.patch.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { unique_id: true }
    })
    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalledOnce()
  })
})
