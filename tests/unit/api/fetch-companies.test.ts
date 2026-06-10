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

const invalidateCompanyCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: invalidateCompanyCachesMock
}))

import { ensurePatchCompaniesFromVNDB } from '~/app/api/edit/fetchCompanies'

describe('ensurePatchCompaniesFromVNDB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    invalidateCompanyCachesMock.mockResolvedValue(undefined)
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
    expect(invalidateCompanyCachesMock).toHaveBeenCalledOnce()
  })
})
