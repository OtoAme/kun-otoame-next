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

const invalidateCompanyCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: invalidateCompanyCachesMock
}))

import { processSubmittedExternalData } from '~/app/api/edit/processExternalData'

describe('processSubmittedExternalData company relations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMocks._tx) => Promise<unknown>) =>
        fn(prismaMocks._tx)
    )
    prismaMocks._tx.patch_company.createMany.mockResolvedValue({ count: 3 })
    prismaMocks._tx.patch_company.updateMany.mockResolvedValue({ count: 3 })
    prismaMocks._tx.$queryRaw.mockResolvedValue([
      { company_id: 1 },
      { company_id: 2 },
      { company_id: 3 }
    ])
    invalidateCompanyCachesMock.mockResolvedValue(undefined)
  })

  it('merges same company names from multiple sources before incrementing count', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])

    await processSubmittedExternalData(
      10,
      {
        vndbTags: [],
        vndbDevelopers: ['A', 'B'],
        bangumiTags: [],
        bangumiDevelopers: ['B', 'C'],
        steamTags: [],
        steamDevelopers: ['A'],
        steamAliases: [],
        dlsiteCircleName: '',
        dlsiteCircleLink: ''
      },
      [],
      100
    )

    expect(prismaMocks._tx.patch_company.createMany).toHaveBeenCalledOnce()
    const createCall = prismaMocks._tx.patch_company.createMany.mock.calls[0][0]
    expect(
      createCall.data.map((company: { name: string }) => company.name)
    ).toEqual(['A', 'B', 'C'])
    expect(prismaMocks._tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
      data: { count: { increment: 1 } }
    })
    expect(invalidateCompanyCachesMock).toHaveBeenCalledOnce()
  })
})
