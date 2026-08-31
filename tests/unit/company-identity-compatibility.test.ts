import { describe, expect, it, vi } from 'vitest'
import {
  CompanyEnsureAmbiguityError,
  ensureCompanyRelationsByName
} from '~/app/api/edit/companyEnsureHelper'

const companyInput = {
  name: 'ＰＡＬＥＴＴＥ',
  introduction: '',
  alias: [],
  primary_language: [],
  official_website: [],
  parent_brand: [],
  user_id: 100
}

const winner = {
  id: 7,
  name: 'Palette',
  alias: [],
  normalized_name: 'palette'
}

const tx = () => ({
  patch_company: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    createManyAndReturn: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 })
  },
  patch_company_name_identity: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  $queryRaw: vi.fn().mockResolvedValue([{ id: 7, company_id: 7 }])
})

describe('legacy company writer Phase B compatibility', () => {
  it('reads the normalized winner after createMany silently skips a unique conflict', async () => {
    const client = tx()
    client.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([winner])
    client.patch_company.createManyAndReturn.mockResolvedValue([])

    const result = await ensureCompanyRelationsByName(
      client as never,
      5,
      new Map([[companyInput.name, companyInput]])
    )

    expect(result).toMatchObject({
      ensured: 0,
      related: 1,
      insertedIds: [7]
    })
    expect(client.$queryRaw).toHaveBeenCalledOnce()
  })

  it('uses normalized winners only after the outer transaction has restarted', async () => {
    const client = tx()
    client.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([winner])

    const result = await ensureCompanyRelationsByName(
      client as never,
      5,
      new Map([[companyInput.name, companyInput]]),
      'legacy',
      true
    )

    expect(result.related).toBe(1)
    expect(client.patch_company.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('rejects a shared alias instead of choosing a company by query order', async () => {
    const client = tx()
    client.patch_company.findMany.mockResolvedValueOnce([
      {
        id: 7,
        name: 'First Studio',
        alias: ['Shared Studio'],
        normalized_name: 'first studio'
      },
      {
        id: 8,
        name: 'Second Studio',
        alias: ['Shared Studio'],
        normalized_name: 'second studio'
      }
    ])

    await expect(
      ensureCompanyRelationsByName(
        client as never,
        5,
        new Map([
          [
            'Shared Studio',
            { ...companyInput, name: 'Shared Studio', alias: [] }
          ]
        ])
      )
    ).rejects.toBeInstanceOf(CompanyEnsureAmbiguityError)

    expect(client.patch_company.createManyAndReturn).not.toHaveBeenCalled()
    expect(client.$queryRaw).not.toHaveBeenCalled()
  })

  it('coalesces normalized-equivalent inputs before creating a company', async () => {
    const client = tx()
    const mergedWinner = {
      id: 7,
      name: 'Palette',
      alias: ['ぱれっと', 'Palette JP'],
      normalized_name: 'palette',
      introduction: 'Primary description',
      primary_language: ['ja', 'en'],
      official_website: ['https://palette.example', 'https://palette.jp'],
      parent_brand: []
    }
    client.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mergedWinner])
    client.patch_company.createManyAndReturn.mockResolvedValue([{ id: 7 }])
    client.patch_company.findUnique.mockResolvedValue({
      ...mergedWinner,
      name_identities: []
    })
    client.patch_company_name_identity.createMany.mockResolvedValue({
      count: 3
    })
    client.patch_company_name_identity.deleteMany.mockResolvedValue({
      count: 0
    })

    const result = await ensureCompanyRelationsByName(
      client as never,
      5,
      new Map([
        [
          'Palette',
          {
            ...companyInput,
            name: 'Palette',
            introduction: 'Primary description',
            alias: ['ぱれっと'],
            primary_language: ['ja'],
            official_website: ['https://palette.example']
          }
        ],
        [
          'ＰＡＬＥＴＴＥ',
          {
            ...companyInput,
            name: 'ＰＡＬＥＴＴＥ',
            introduction: 'Secondary description',
            alias: ['Palette JP'],
            primary_language: ['en'],
            official_website: ['https://palette.jp']
          }
        ]
      ]),
      'authoritative'
    )

    expect(client.patch_company.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            name: 'Palette',
            introduction: 'Primary description',
            alias: expect.arrayContaining(['ぱれっと', 'Palette JP']),
            primary_language: ['ja', 'en'],
            official_website: ['https://palette.example', 'https://palette.jp'],
            normalized_name: 'palette'
          })
        ]
      })
    )
    expect(result).toMatchObject({ ensured: 1, related: 1 })
  })

  it('rejects alias-to-name overlap between distinct batch companies', async () => {
    const client = tx()

    await expect(
      ensureCompanyRelationsByName(
        client as never,
        5,
        new Map([
          [
            'Palette',
            { ...companyInput, name: 'Palette', alias: ['ぱれっと'] }
          ],
          ['ぱれっと', { ...companyInput, name: 'ぱれっと', alias: [] }]
        ]),
        'authoritative'
      )
    ).rejects.toBeInstanceOf(CompanyEnsureAmbiguityError)

    expect(client.patch_company.findMany).not.toHaveBeenCalled()
    expect(client.patch_company.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('enriches a unique existing match with authoritative VNDB metadata', async () => {
    const client = tx()
    const existing = {
      id: 7,
      name: 'VNDB Studio',
      alias: [],
      normalized_name: 'vndb studio',
      introduction: '',
      primary_language: [],
      official_website: [],
      parent_brand: []
    }
    client.patch_company.findMany.mockResolvedValueOnce([existing])
    client.patch_company.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValue({
        ...existing,
        introduction: 'Visual novel developer.',
        alias: ['Original Studio'],
        primary_language: ['ja'],
        official_website: ['https://studio.example'],
        name_identities: []
      })
    client.patch_company_name_identity.createMany.mockResolvedValue({
      count: 2
    })
    client.patch_company_name_identity.deleteMany.mockResolvedValue({
      count: 0
    })

    await ensureCompanyRelationsByName(
      client as never,
      5,
      new Map([
        [
          'VNDB Studio',
          {
            ...companyInput,
            name: 'VNDB Studio',
            introduction: 'Visual novel developer.',
            alias: ['Original Studio'],
            primary_language: ['ja'],
            official_website: ['https://studio.example']
          }
        ]
      ]),
      'authoritative'
    )

    expect(client.patch_company.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        introduction: 'Visual novel developer.',
        alias: ['Original Studio'],
        primary_language: ['ja'],
        official_website: ['https://studio.example']
      }
    })
    expect(client.patch_company_name_identity.createMany).toHaveBeenCalled()
  })

  it('locks and reloads existing metadata before concurrent enrichment', async () => {
    const state = {
      id: 7,
      name: 'VNDB Studio',
      alias: [] as string[],
      normalized_name: 'vndb studio',
      introduction: '',
      primary_language: [] as string[],
      official_website: [] as string[],
      parent_brand: [] as string[]
    }
    let initialReads = 0
    let releaseInitialReads = () => {}
    const initialReadBarrier = new Promise<void>((resolve) => {
      releaseInitialReads = resolve
    })
    let releaseSecondWriter = () => {}
    const firstWriterCommitted = new Promise<void>((resolve) => {
      releaseSecondWriter = resolve
    })

    const createConcurrentClient = (waitForFirstWriter: boolean) => {
      let rawQueryCalls = 0
      return {
        patch_company: {
          findMany: vi.fn(async () => {
            initialReads += 1
            if (initialReads === 2) releaseInitialReads()
            await initialReadBarrier
            return [{ ...state, alias: [...state.alias] }]
          }),
          findUnique: vi.fn(async () => ({
            ...state,
            alias: [...state.alias],
            primary_language: [...state.primary_language],
            official_website: [...state.official_website],
            parent_brand: [...state.parent_brand],
            name_identities: []
          })),
          createManyAndReturn: vi.fn(),
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(state, data)
            return {}
          }),
          updateMany: vi.fn()
        },
        patch_company_name_identity: {
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          update: vi.fn(),
          updateMany: vi.fn()
        },
        $queryRaw: vi.fn(async () => {
          rawQueryCalls += 1
          if (waitForFirstWriter && rawQueryCalls === 1) {
            await firstWriterCommitted
          }
          return rawQueryCalls === 3 ? [] : [{ id: 7 }]
        })
      }
    }

    const firstClient = createConcurrentClient(false)
    const secondClient = createConcurrentClient(true)
    const first = ensureCompanyRelationsByName(
      firstClient as never,
      5,
      new Map([
        [
          'VNDB Studio',
          { ...companyInput, name: 'VNDB Studio', alias: ['First Alias'] }
        ]
      ]),
      'authoritative'
    )
    const second = ensureCompanyRelationsByName(
      secondClient as never,
      6,
      new Map([
        [
          'VNDB Studio',
          { ...companyInput, name: 'VNDB Studio', alias: ['Second Alias'] }
        ]
      ]),
      'authoritative'
    )

    await first
    releaseSecondWriter()
    await second

    expect(state.alias).toEqual(['First Alias', 'Second Alias'])
    expect(firstClient.patch_company.update).toHaveBeenCalledOnce()
    expect(secondClient.patch_company.update).toHaveBeenCalledOnce()
  })
})
