import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const ensurePatchCompaniesFromVNDBMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/fetchCompanies', () => ({
  ensurePatchCompaniesFromVNDB: ensurePatchCompaniesFromVNDBMock
}))

import { processSubmittedExternalData } from '~/app/api/edit/processExternalData'

describe('processSubmittedExternalData company relations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
    ensurePatchCompaniesFromVNDBMock.mockResolvedValue({
      ensured: 0,
      related: 0
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges same company names from fallback and secondary sources before incrementing count', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, name: 'A', alias: [] },
        { id: 2, name: 'B', alias: [] },
        { id: 3, name: 'C', alias: [] }
      ])

    await processSubmittedExternalData(
      10,
      {
        vndbTags: [],
        vndbDevelopers: [],
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
    ).toEqual(['B', 'C', 'A'])
    expect(prismaMocks._tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
      data: { count: { increment: 1 } }
    })
    expect(invalidateCompanyCachesMock).toHaveBeenCalledOnce()
  })

  it('uses Bangumi developers only when VNDB developers are empty', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, name: 'VNDB Studio', alias: [] },
        { id: 2, name: 'Steam Publisher', alias: [] },
        { id: 3, name: 'DLSite Circle', alias: [] }
      ])

    await processSubmittedExternalData(
      10,
      {
        vndbTags: [],
        vndbDevelopers: ['VNDB Studio'],
        bangumiTags: [],
        bangumiDevelopers: ['Bangumi Studio'],
        steamTags: [],
        steamDevelopers: ['Steam Publisher'],
        steamAliases: [],
        dlsiteCircleName: 'DLSite Circle',
        dlsiteCircleLink: ''
      },
      [],
      100
    )

    const createCall = prismaMocks._tx.patch_company.createMany.mock.calls[0][0]
    expect(
      createCall.data.map((company: { name: string }) => company.name)
    ).toEqual(['VNDB Studio', 'Steam Publisher', 'DLSite Circle'])
  })

  it('maps submitted company names to existing company aliases', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([
        { id: 7, name: 'Existing Studio', alias: ['VNDB Studio'] }
      ])
      .mockResolvedValueOnce([
        { id: 7, name: 'Existing Studio', alias: ['VNDB Studio'] }
      ])
    prismaMocks._tx.$queryRaw.mockResolvedValue([{ company_id: 7 }])

    await processSubmittedExternalData(
      10,
      {
        vndbTags: [],
        vndbDevelopers: ['VNDB Studio'],
        bangumiTags: [],
        bangumiDevelopers: [],
        steamTags: [],
        steamDevelopers: [],
        steamAliases: [],
        dlsiteCircleName: '',
        dlsiteCircleLink: ''
      },
      [],
      100
    )

    expect(prismaMocks._tx.patch_company.createMany).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      data: { count: { increment: 1 } }
    })
  })

  it('fetches VNDB companies on submit and skips submitted developer fallback when VNDB succeeds', async () => {
    ensurePatchCompaniesFromVNDBMock.mockResolvedValue({
      ensured: 1,
      related: 1
    })

    await processSubmittedExternalData(
      10,
      {
        vndbId: 'v123',
        vndbTags: [],
        vndbDevelopers: ['Submitted VNDB Studio'],
        bangumiTags: [],
        bangumiDevelopers: ['Bangumi Studio'],
        steamTags: [],
        steamDevelopers: [],
        steamAliases: [],
        dlsiteCircleName: '',
        dlsiteCircleLink: ''
      },
      [],
      100
    )

    expect(ensurePatchCompaniesFromVNDBMock).toHaveBeenCalledWith(
      10,
      'v123',
      100
    )
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('uses Bangumi fallback when submitted and fetched VNDB companies are empty', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 4, name: 'Bangumi Studio', alias: [] }])

    await processSubmittedExternalData(
      10,
      {
        vndbId: 'v123',
        vndbTags: [],
        vndbDevelopers: [],
        bangumiTags: [],
        bangumiDevelopers: ['Bangumi Studio'],
        steamTags: [],
        steamDevelopers: [],
        steamAliases: [],
        dlsiteCircleName: '',
        dlsiteCircleLink: ''
      },
      [],
      100
    )

    expect(ensurePatchCompaniesFromVNDBMock).toHaveBeenCalledWith(
      10,
      'v123',
      100
    )
    expect(prismaMocks._tx.patch_company.createMany).toHaveBeenCalledWith({
      data: [
        {
          name: 'Bangumi Studio',
          introduction: '',
          count: 0,
          primary_language: [],
          official_website: [],
          parent_brand: [],
          alias: [],
          user_id: 100
        }
      ],
      skipDuplicates: true
    })
  })

  it('uses submitted VNDB developers before Bangumi when fetched VNDB companies are empty', async () => {
    prismaMocks._tx.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 5, name: 'Submitted VNDB Studio', alias: [] }])

    await processSubmittedExternalData(
      10,
      {
        vndbId: 'v123',
        vndbTags: [],
        vndbDevelopers: ['Submitted VNDB Studio'],
        bangumiTags: [],
        bangumiDevelopers: ['Bangumi Studio'],
        steamTags: [],
        steamDevelopers: [],
        steamAliases: [],
        dlsiteCircleName: '',
        dlsiteCircleLink: ''
      },
      [],
      100
    )

    const createCall = prismaMocks._tx.patch_company.createMany.mock.calls[0][0]
    expect(
      createCall.data.map((company: { name: string }) => company.name)
    ).toEqual(['Submitted VNDB Studio'])
  })

  it('propagates company write failures instead of silently creating a patch without companies', async () => {
    prismaMocks.$transaction.mockRejectedValueOnce(new Error('db failed'))

    await expect(
      processSubmittedExternalData(
        10,
        {
          vndbTags: [],
          vndbDevelopers: ['VNDB Studio'],
          bangumiTags: [],
          bangumiDevelopers: [],
          steamTags: [],
          steamDevelopers: [],
          steamAliases: [],
          dlsiteCircleName: '',
          dlsiteCircleLink: ''
        },
        [],
        100
      )
    ).rejects.toThrow('db failed')
  })
})
