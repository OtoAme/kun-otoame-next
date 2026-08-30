import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_company: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    patch_company_name_identity: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn()
    },
    $queryRaw: vi.fn()
  }
  return {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    ),
    _tx: tx
  }
})
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const invalidateCompanyCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: invalidateCompanyCachesMock
}))

import { ensurePatchCompanyFromDlsite } from '~/app/api/edit/dlsite'

describe('DLSite company identity projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks._tx.patch_company.findFirst.mockResolvedValue(null)
    prismaMocks._tx.patch_company.create.mockResolvedValue({
      id: 7,
      name: 'Circle',
      alias: [],
      normalized_name: 'circle'
    })
    prismaMocks._tx.patch_company.findUnique.mockResolvedValue({
      name: 'Circle',
      alias: [],
      normalized_name: 'circle',
      name_identities: []
    })
    prismaMocks._tx.patch_company_name_identity.createMany.mockResolvedValue({
      count: 1
    })
    prismaMocks._tx.patch_company_name_identity.deleteMany.mockResolvedValue({
      count: 0
    })
    prismaMocks._tx.patch_company_name_identity.update.mockResolvedValue({})
    prismaMocks._tx.$queryRaw.mockResolvedValue([{ company_id: 7 }])
    prismaMocks._tx.patch_company.updateMany.mockResolvedValue({ count: 1 })
    invalidateCompanyCachesMock.mockResolvedValue(undefined)
  })

  it('creates the company and its identity before relating it', async () => {
    await ensurePatchCompanyFromDlsite(
      10,
      'RJ123',
      100,
      'Circle',
      'https://example.test/circle'
    )

    expect(prismaMocks._tx.patch_company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ normalized_name: 'circle' })
      })
    )
    expect(
      prismaMocks._tx.patch_company_name_identity.createMany
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          company_id: 7,
          kind: 'name',
          origin: 'authoritative',
          normalized_value: 'circle'
        })
      ],
      skipDuplicates: true
    })
    // One row lock for the identity projection, then one relation INSERT.
    expect(prismaMocks._tx.$queryRaw).toHaveBeenCalledTimes(2)
  })
})
