import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    patch_company: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    company_merge_suggestion: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    company_merge_pending_key: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn()
    },
    patch: {
      findMany: vi.fn()
    }
  }
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)
  )
  return { prisma }
})

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))

import { detectCompanyMergeSuggestions } from '~/app/api/admin/company-merges/service'
import {
  SOURCE_PAIR_NEXTMOE_BATCH,
  SOURCE_PAIR_NEXTMOE_PAUSE_MS,
  suggestSourcePairHits
} from '~/app/api/company/identity/sourcePairSuggestions'
import { NEXTMOE_CATALOG_BATCH_MAX } from '~/app/api/company/nextmoe/types'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { getCompanyMergeSuggestionKindLabel } from '~/types/api/companyMerges'
import type { VndbProducer } from '~/lib/arnebiae/vndb'

const company = (id: number, name: string, alias: string[] = []) => ({
  id,
  name,
  normalizedName: normalizeCompanyValue(name),
  alias
})

const scannedCompany = (id: number, name: string) => ({
  id,
  name,
  normalized_name: normalizeCompanyValue(name),
  alias: [] as string[],
  name_identities: [],
  external_ids: []
})

const expectNoCompanyWrites = () => {
  expect(mocks.prisma.patch_company.create).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.update).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.updateMany).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.delete).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.deleteMany).not.toHaveBeenCalled()
}

const tenkyDevelopers: VndbProducer[] = [
  { id: 'p1850', name: 'Tenky', original: 'テンキー', type: 'co' },
  { id: 'p1072', name: 'KONAMI', original: 'コナミ', type: 'co' }
]

const mebiusDevelopers: VndbProducer[] = [
  { id: 'p1', name: 'Mebius', original: 'メビウス', type: 'co' },
  { id: 'p2', name: 'Cherrymochi', original: 'チェリモチ', type: 'co' }
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('tests must not hit the network')
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('source-pair kind label', () => {
  it('labels source-pair as same-work alias matches', () => {
    expect(getCompanyMergeSuggestionKindLabel('source-pair')).toBe(
      '同一作品在 VNDB 或 NextMoe 中的名称相对应'
    )
    expect(getCompanyMergeSuggestionKindLabel('suffix-unique-hit')).toBe(
      '去除公司后缀后名称一致'
    )
    expect(getCompanyMergeSuggestionKindLabel('name-variant')).toBe(
      '标点、括号、公司后缀或中外文连写不同'
    )
  })
})

describe('suggestSourcePairHits', () => {
  it('asks NextMoe for works in full catalog batches, one request at a time', async () => {
    const listNextmoeWorksByRefs = vi.fn(async (refs: string[]) => ({
      object: 'list' as const,
      items: [],
      missing: refs
    }))
    const sleep = vi.fn(async () => {})
    const progress: Array<{ phase: string; current: number; total: number }> =
      []
    const patches = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1,
      vndbId: `v${index + 1}`,
      bangumiId: null,
      companyIds: [1, 2]
    }))

    await suggestSourcePairHits(
      [company(1, 'Alpha'), company(2, 'Beta')],
      patches,
      {
        listNextmoeWorksByRefs,
        isNextmoeConfigured: () => true,
        loadVndbDevelopers: async () => [],
        sleep,
        onProgress: (event) => {
          if (event.phase === 'nextmoe') progress.push(event)
        }
      }
    )

    expect(SOURCE_PAIR_NEXTMOE_BATCH).toBe(NEXTMOE_CATALOG_BATCH_MAX)
    expect(SOURCE_PAIR_NEXTMOE_PAUSE_MS).toBe(200)
    expect(listNextmoeWorksByRefs).toHaveBeenCalledTimes(2)
    expect(listNextmoeWorksByRefs.mock.calls[0]?.[0]).toHaveLength(100)
    expect(listNextmoeWorksByRefs.mock.calls[1]?.[0]).toHaveLength(50)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(200)
    expect(progress.at(-1)).toMatchObject({
      phase: 'nextmoe',
      current: 2,
      total: 2
    })
  })

  it('pairs Tenky with テンキー from VNDB and leaves KONAMI out', async () => {
    const sleep = vi.fn(async () => {})
    const suggestions = await suggestSourcePairHits(
      [
        company(363, 'KONAMI', ['テンキー']),
        company(446, 'Tenky'),
        company(447, 'テンキー')
      ],
      [
        {
          id: 99,
          vndbId: 'v3996',
          bangumiId: null,
          companyIds: [363, 446, 447]
        }
      ],
      {
        loadVndbDevelopers: async () => tenkyDevelopers,
        isNextmoeConfigured: () => false,
        sleep
      }
    )

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      kind: 'source-pair',
      targetCompanyId: 446,
      sourceCompanyIds: [447]
    })
    expect(suggestions[0].names).toEqual(['Tenky', 'テンキー'])
    expect(suggestions[0].evidence).toMatchObject({
      kind: 'source-pair',
      patchId: 99,
      upstreamIds: ['vndb:p1850']
    })
    expect(suggestions[0].evidence.bag).toEqual(
      expect.arrayContaining(['Tenky', 'テンキー'])
    )
    expect(suggestions[0].names).not.toContain('KONAMI')
    expect(suggestions[0].evidence.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: 446,
          source: 'vndb',
          field: 'name',
          value: 'Tenky'
        }),
        expect.objectContaining({
          companyId: 447,
          source: 'vndb',
          field: 'original',
          value: 'テンキー'
        })
      ])
    )
  })

  it('records a VNDB alias as hit evidence', async () => {
    const suggestions = await suggestSourcePairHits(
      [
        company(407, 'Kotama Yuri'),
        company(408, 'WINGALD'),
        company(409, '小珠ゆり')
      ],
      [
        {
          id: 814,
          vndbId: 'v1',
          bangumiId: null,
          companyIds: [407, 408, 409]
        }
      ],
      {
        loadVndbDevelopers: async () => [
          {
            id: 'p5101',
            name: 'Kotama Yuri',
            original: '小珠ゆり',
            aliases: ['WINGALD'],
            type: 'co'
          }
        ],
        isNextmoeConfigured: () => false,
        sleep: async () => {}
      }
    )

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(407)
    expect(suggestions[0].sourceCompanyIds).toEqual([408, 409])
    expect(suggestions[0].evidence.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: 408,
          source: 'vndb',
          field: 'alias',
          value: 'WINGALD'
        }),
        expect.objectContaining({
          companyId: 409,
          source: 'vndb',
          field: 'original',
          value: '小珠ゆり'
        })
      ])
    )
  })

  it('pairs Mebius variants from NextMoe and leaves Cherrymochi out', async () => {
    const suggestions = await suggestSourcePairHits(
      [
        company(459, 'Mebius'),
        company(460, 'Cherrymochi'),
        company(461, 'Mebius（株式会社メビウス）')
      ],
      [
        {
          id: 12,
          vndbId: 'v49059',
          bangumiId: 473829,
          companyIds: [459, 460, 461]
        }
      ],
      {
        loadVndbDevelopers: async () => [],
        isNextmoeConfigured: () => true,
        sleep: async () => {},
        listNextmoeWorksByRefs: async () => ({
          object: 'list',
          items: [
            {
              object: 'work',
              id: 'w_gion',
              refs: [
                { source: 'vndb', external_id: 'v49059' },
                { source: 'bangumi', external_id: '473829' }
              ],
              companies: [
                {
                  object: 'company',
                  id: 'c_mebius',
                  display_name: 'Mebius'
                },
                {
                  object: 'company',
                  id: 'c_cherry',
                  display_name: 'Cherrymochi'
                }
              ]
            }
          ]
        }),
        listNextmoeCompaniesByIds: async () => {
          throw new Error('detect must not hydrate NextMoe company aliases')
        }
      }
    )

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(459)
    expect(suggestions[0].sourceCompanyIds).toEqual([461])
    expect(suggestions[0].names).not.toContain('Cherrymochi')
    expect(suggestions[0].evidence).toMatchObject({
      kind: 'source-pair',
      patchId: 12,
      upstreamIds: ['c_mebius']
    })
  })
})

describe('detectCompanyMergeSuggestions source-pair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([])
    mocks.prisma.company_merge_suggestion.create.mockResolvedValue({ id: 1 })
  })

  it('writes Tenky + テンキー as source-pair and does not include KONAMI', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      scannedCompany(363, 'KONAMI'),
      scannedCompany(446, 'Tenky'),
      scannedCompany(447, 'テンキー')
    ])
    mocks.prisma.patch.findMany.mockResolvedValue([
      {
        id: 99,
        vndb_id: 'v3996',
        bangumi_id: null,
        company: [{ company_id: 363 }, { company_id: 446 }, { company_id: 447 }]
      }
    ])

    await expect(
      detectCompanyMergeSuggestions({
        loadVndbDevelopers: async () => tenkyDevelopers,
        isNextmoeConfigured: () => false,
        sleep: async () => {}
      })
    ).resolves.toEqual(
      expect.objectContaining({ created: 1, updated: 0, skipped: 0 })
    )

    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledTimes(
      1
    )
    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'source-pair',
        target_company_id: 446,
        source_company_ids: [447],
        names: ['Tenky', 'テンキー'],
        member_key: '446,447',
        candidate_key: 'source-pair|vndb:p1850|patch:99',
        evidence: expect.objectContaining({
          kind: 'source-pair',
          patchId: 99,
          upstreamIds: ['vndb:p1850'],
          hits: expect.arrayContaining([
            expect.objectContaining({ source: 'vndb', field: 'name', value: 'Tenky' })
          ])
        })
      })
    })
    expect(mocks.prisma.company_merge_pending_key.create).toHaveBeenCalledWith({
      data: { member_key: '446,447', suggestion_id: 1 }
    })
    const evidence =
      mocks.prisma.company_merge_suggestion.create.mock.calls[0][0].data
        .evidence
    expect(evidence.bag).toEqual(expect.arrayContaining(['Tenky', 'テンキー']))
    expectNoCompanyWrites()
  })

  it('does not add Cherrymochi when layer 1 already unions Mebius', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      scannedCompany(459, 'Mebius'),
      scannedCompany(460, 'Cherrymochi'),
      scannedCompany(461, 'Mebius（株式会社メビウス）'),
      scannedCompany(462, 'mebius.')
    ])
    mocks.prisma.patch.findMany.mockResolvedValue([
      {
        id: 12,
        vndb_id: 'v49059',
        bangumi_id: null,
        company: [
          { company_id: 459 },
          { company_id: 460 },
          { company_id: 461 },
          { company_id: 462 }
        ]
      }
    ])

    await expect(
      detectCompanyMergeSuggestions({
        loadVndbDevelopers: async () => mebiusDevelopers,
        isNextmoeConfigured: () => false,
        sleep: async () => {}
      })
    ).resolves.toEqual(
      expect.objectContaining({ created: 1, updated: 0, skipped: 0 })
    )

    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledTimes(
      1
    )
    const created =
      mocks.prisma.company_merge_suggestion.create.mock.calls[0][0].data
    expect(created.kind).toBe('name-variant')
    expect(created.target_company_id).toBe(459)
    expect(created.source_company_ids).toEqual([461, 462])
    expect(created.names).not.toContain('Cherrymochi')
    expectNoCompanyWrites()
  })

  it('returns layer 1 counts when the source-pair fetcher throws', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      scannedCompany(1, 'Koei'),
      scannedCompany(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.patch.findMany.mockResolvedValue([
      {
        id: 7,
        vndb_id: 'v2168',
        bangumi_id: null,
        company: [{ company_id: 1 }, { company_id: 2 }]
      }
    ])
    const loadVndbDevelopers = vi.fn(async () => {
      throw new Error('VNDB API error: 429')
    })

    await expect(
      detectCompanyMergeSuggestions({
        loadVndbDevelopers,
        isNextmoeConfigured: () => false,
        sleep: async () => {}
      })
    ).resolves.toEqual(
      expect.objectContaining({ created: 1, updated: 0, skipped: 0 })
    )

    expect(loadVndbDevelopers).toHaveBeenCalled()
    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'suffix-unique-hit',
        target_company_id: 1,
        source_company_ids: [2]
      })
    })
    expectNoCompanyWrites()
  })
})
