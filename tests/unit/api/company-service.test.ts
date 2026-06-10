import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_company: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('~/prisma', () => ({
  prisma: prismaMocks
}))

vi.mock('~/lib/redis', () => ({
  getOrSet: vi.fn()
}))

const invalidateCompanyCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: invalidateCompanyCachesMock
}))

vi.mock('~/app/api/patch/views/realtime', () => ({
  withRealtimePatchViews: vi.fn()
}))

import { createCompany, rewriteCompany } from '~/app/api/company/service'

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
    invalidateCompanyCachesMock.mockResolvedValue(undefined)
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
})
