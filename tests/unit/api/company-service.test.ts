import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const patchCompany = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
  const tx = {
    $queryRaw: vi.fn(),
    patch_company: patchCompany,
    patch_company_name_identity: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn()
    }
  }
  return {
    patch_company: patchCompany,
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma', () => ({
  prisma: prismaMocks
}))

vi.mock('~/lib/redis', () => ({
  getOrSet: vi.fn()
}))

const cacheMocks = vi.hoisted(() => ({
  invalidateCompanyCaches: vi.fn(),
  invalidatePatchContentCache: vi.fn()
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: cacheMocks.invalidateCompanyCaches,
  invalidatePatchContentCache: cacheMocks.invalidatePatchContentCache
}))

vi.mock('~/app/api/patch/views/realtime', () => ({
  withRealtimePatchViews: vi.fn()
}))

import {
  createCompany,
  deleteCompany,
  rewriteCompany
} from '~/app/api/company/service'

describe('company service alias conflict checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch_company.findFirst.mockResolvedValue(null)
    prismaMocks.patch_company.create.mockResolvedValue({
      id: 1,
      name: 'New Studio',
      count: 0,
      alias: []
    })
    prismaMocks.patch_company.update.mockResolvedValue({
      id: 1,
      name: 'New Studio',
      count: 0,
      alias: []
    })
    prismaMocks.patch_company.delete.mockResolvedValue({})
    prismaMocks.patch_company.findUnique.mockResolvedValue({
      name: 'New Studio',
      alias: [],
      normalized_name: null,
      name_identities: [],
      patch_relations: []
    })
    prismaMocks._tx.patch_company_name_identity.createMany.mockResolvedValue({
      count: 1
    })
    prismaMocks._tx.patch_company_name_identity.deleteMany.mockResolvedValue({
      count: 0
    })
    prismaMocks._tx.patch_company_name_identity.update.mockResolvedValue({})
    prismaMocks._tx.$queryRaw.mockResolvedValue([{ id: 1 }])
    cacheMocks.invalidateCompanyCaches.mockResolvedValue(undefined)
    cacheMocks.invalidatePatchContentCache.mockResolvedValue(undefined)
  })

  it('rejects creating a company when a submitted alias matches another company alias', async () => {
    prismaMocks.patch_company.findFirst.mockImplementation(({ where }) =>
      JSON.stringify(where).includes('Existing Alias')
        ? Promise.resolve({ id: 5 })
        : Promise.resolve(null)
    )

    const result = await createCompany(
      {
        name: 'New Studio',
        introduction: '',
        alias: ['Existing Alias'],
        primary_language: ['ja'],
        official_website: [],
        parent_brand: []
      },
      100
    )

    expect(result).toBe('这个会社已经存在了')
    expect(prismaMocks.patch_company.create).not.toHaveBeenCalled()
  })

  it('rejects rewriting a company when a submitted alias matches another company name', async () => {
    prismaMocks.patch_company.findFirst.mockImplementation(({ where }) =>
      JSON.stringify(where).includes('Taken Studio')
        ? Promise.resolve({ id: 5 })
        : Promise.resolve(null)
    )

    const result = await rewriteCompany({
      companyId: 1,
      name: 'New Studio',
      introduction: '',
      alias: ['Taken Studio'],
      primary_language: ['ja'],
      official_website: [],
      parent_brand: []
    })

    expect(result).toBe('这个会社已经存在了')
    expect(prismaMocks.patch_company.update).not.toHaveBeenCalled()
  })

  it('invalidates affected patch detail caches after deleting a company', async () => {
    prismaMocks.patch_company.findUnique.mockResolvedValue({
      patch_relations: [
        { patch: { unique_id: 'abc12345' } },
        { patch: { unique_id: 'def67890' } },
        { patch: { unique_id: 'abc12345' } }
      ]
    })

    await expect(deleteCompany({ companyId: 7 })).resolves.toEqual({})

    expect(prismaMocks.patch_company.delete).toHaveBeenCalledWith({
      where: { id: 7 }
    })
    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'def67890'
    )
    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledTimes(2)
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalledWith(7)
  })

  it('creates the company and its identity projection in one transaction', async () => {
    prismaMocks.patch_company.findUnique.mockResolvedValue({
      name: 'Ｎｅｗ Studio',
      alias: ['新会社'],
      normalized_name: 'new studio',
      name_identities: []
    })
    await createCompany(
      {
        name: 'Ｎｅｗ Studio',
        introduction: '',
        alias: ['新会社'],
        primary_language: ['ja'],
        official_website: [],
        parent_brand: []
      },
      100
    )

    expect(prismaMocks.$transaction).toHaveBeenCalledOnce()
    expect(prismaMocks.patch_company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ normalized_name: 'new studio' })
      })
    )
    expect(
      prismaMocks._tx.patch_company_name_identity.createMany
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          company_id: 1,
          kind: 'name',
          origin: 'authoritative',
          normalized_value: 'new studio'
        }),
        expect.objectContaining({
          company_id: 1,
          kind: 'alias',
          origin: 'authoritative',
          normalized_value: '新会社'
        })
      ],
      skipDuplicates: true
    })
  })

  it('rewrites aliases and their identity projection in one transaction', async () => {
    prismaMocks.patch_company.update.mockResolvedValue({
      id: 1,
      name: 'New Studio',
      count: 0,
      alias: ['Current Alias']
    })
    prismaMocks.patch_company.findUnique.mockResolvedValue({
      name: 'New Studio',
      alias: ['Current Alias'],
      normalized_name: 'new studio',
      name_identities: []
    })

    await rewriteCompany({
      companyId: 1,
      name: 'New Studio',
      introduction: '',
      alias: ['Current Alias'],
      primary_language: ['ja'],
      official_website: [],
      parent_brand: []
    })

    expect(prismaMocks.$transaction).toHaveBeenCalledOnce()
    expect(prismaMocks.patch_company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ normalized_name: 'new studio' })
      })
    )
    expect(
      prismaMocks._tx.patch_company_name_identity.createMany
    ).toHaveBeenCalled()
  })
})
