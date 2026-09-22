import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
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
    patch: {
      findMany: vi.fn()
    },
    user: {
      findMany: vi.fn()
    }
  }
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))

import {
  detectCompanyMergeSuggestions,
  dismissCompanyMergeSuggestion,
  listCompanyMergeSuggestions,
  reopenCompanyMergeSuggestion
} from '~/app/api/admin/company-merges/service'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { listCompanyMergeSuggestionsSchema } from '~/validations/companyMerges'

type ExternalIdRow = { source: string; external_id: string }
type IdentityRow = { origin: string; kind: string; normalized_value: string }

const company = (
  id: number,
  name: string,
  extra: {
    externalIds?: ExternalIdRow[]
    identities?: IdentityRow[]
  } = {}
) => ({
  id,
  name,
  normalized_name: normalizeCompanyValue(name),
  alias: [] as string[],
  name_identities: extra.identities ?? [],
  external_ids: extra.externalIds ?? []
})

const expectNoCompanyWrites = () => {
  expect(mocks.prisma.patch_company.create).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.update).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.updateMany).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.delete).not.toHaveBeenCalled()
  expect(mocks.prisma.patch_company.deleteMany).not.toHaveBeenCalled()
}

const suggestionRow = (
  extra: {
    resolved_at?: Date | null
    resolved_by_user_id?: number | null
  } = {}
) => ({
  id: 3,
  kind: 'suffix-unique-hit',
  folded_key: 'koei',
  target_company_id: 1,
  source_company_ids: [2],
  names: ['Koei', 'KOEI Co., Ltd.'],
  detected_at: new Date('2026-09-17T03:04:05.000Z'),
  resolved_at: extra.resolved_at ?? null,
  resolved_by_user_id: extra.resolved_by_user_id ?? null
})

const liveCompanies = [
  {
    id: 1,
    name: 'Koei',
    alias: ['光栄'],
    introduction: '',
    user_id: 42,
    official_website: ['https://koei.example'],
    parent_brand: ['Koei Tecmo']
  },
  {
    id: 2,
    name: 'KOEI Co., Ltd.',
    alias: [],
    introduction: '',
    user_id: 42,
    official_website: [],
    parent_brand: []
  }
]

describe('detectCompanyMergeSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
  })

  it('writes one pending suggestion for a folded-key cluster', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([])
    mocks.prisma.company_merge_suggestion.create.mockResolvedValue({ id: 1 })

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledTimes(
      1
    )
    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledWith({
      data: {
        kind: 'suffix-unique-hit',
        status: 'pending',
        folded_key: 'koei',
        target_company_id: 1,
        source_company_ids: [2],
        names: ['Koei', 'KOEI Co., Ltd.'],
        evidence: { kind: 'suffix-unique-hit', foldedKey: 'koei' },
        detected_at: expect.any(Date)
      }
    })
    expectNoCompanyWrites()
  })

  it('refreshes the pending row of the same folded key instead of adding one', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.'),
      company(3, 'Koei Inc.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      { id: 9, folded_key: 'koei', status: 'pending' }
    ])
    mocks.prisma.company_merge_suggestion.update.mockResolvedValue({ id: 9 })

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 0,
      updated: 1,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(mocks.prisma.company_merge_suggestion.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        target_company_id: 1,
        source_company_ids: [2, 3],
        names: ['Koei', 'KOEI Co., Ltd.', 'Koei Inc.'],
        evidence: { kind: 'suffix-unique-hit', foldedKey: 'koei' },
        detected_at: expect.any(Date)
      }
    })
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('leaves a dismissed folded key dismissed', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      { id: 9, folded_key: 'koei', status: 'dismissed' }
    ])

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 0,
      updated: 0,
      skipped: 1,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_suggestion.update).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('does not suggest a cluster whose members carry different external ids', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei', {
        externalIds: [{ source: 'vndb', external_id: 'p1' }]
      }),
      company(2, 'KOEI Co., Ltd.', {
        externalIds: [{ source: 'vndb', external_id: 'p2' }]
      })
    ])

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(
      mocks.prisma.company_merge_suggestion.findMany
    ).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
  })

  it('drops only the company that holds two ids for one source', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei', {
        externalIds: [
          { source: 'vndb', external_id: 'p1' },
          { source: 'vndb', external_id: 'p2' }
        ]
      }),
      company(2, 'KOEI Co., Ltd.'),
      company(3, 'Koei Inc.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([])
    mocks.prisma.company_merge_suggestion.create.mockResolvedValue({ id: 1 })

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_company_id: 2,
        source_company_ids: [3]
      })
    })
    expectNoCompanyWrites()
  })

  it('scans companies but never touches them', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([])
    mocks.prisma.company_merge_suggestion.create.mockResolvedValue({ id: 1 })

    await detectCompanyMergeSuggestions()

    expect(mocks.prisma.patch_company.findMany).toHaveBeenCalledTimes(1)
    for (const call of mocks.prisma.patch_company.findMany.mock.calls) {
      expect(call[0]).not.toHaveProperty('where')
    }
    expectNoCompanyWrites()
  })
})

describe('listCompanyMergeSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns pending rows in the API shape with their participant companies', async () => {
    // 空白会被折叠, 超过 60 字只发开头一段
    const longIntroduction = '甲 '.repeat(40).trim()
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      suggestionRow()
    ])
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      {
        ...liveCompanies[0],
        introduction: longIntroduction
      },
      liveCompanies[1]
    ])

    const result = await listCompanyMergeSuggestions()

    expect(result.items[0]).toEqual({
      id: 3,
      kind: 'suffix-unique-hit',
      status: 'pending',
      foldedKey: 'koei',
      targetCompanyId: 1,
      sourceCompanyIds: [2],
      names: ['Koei', 'KOEI Co., Ltd.'],
      participants: [
        {
          companyId: 1,
          name: 'Koei',
          aliases: ['光栄'],
          introductionPreview: `${longIntroduction.slice(0, 60)}…`,
          ownerId: 42,
          officialWebsites: ['https://koei.example'],
          parentBrands: ['Koei Tecmo']
        },
        {
          companyId: 2,
          name: 'KOEI Co., Ltd.',
          aliases: [],
          introductionPreview: '',
          ownerId: 42,
          officialWebsites: [],
          parentBrands: []
        }
      ],
      detectedAt: '2026-09-17T03:04:05.000Z',
      resolvedAt: null,
      resolvedByUserId: null
    })

    expect(mocks.prisma.company_merge_suggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending' },
        orderBy: [{ detected_at: 'desc' }, { id: 'desc' }]
      })
    )
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('keeps a cluster readable when one of its companies is already gone', async () => {
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      suggestionRow()
    ])
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Koei',
        alias: [],
        introduction: '',
        user_id: 42,
        official_website: [],
        parent_brand: []
      }
    ])

    const result = await listCompanyMergeSuggestions()

    expect(result.items[0].participants[1]).toEqual({
      companyId: 2,
      name: null,
      aliases: [],
      introductionPreview: '',
      ownerId: null,
      officialWebsites: [],
      parentBrands: []
    })
  })

  it('does not read the company table when the queue is empty', async () => {
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([])

    await expect(listCompanyMergeSuggestions()).resolves.toEqual({ items: [] })
    expect(mocks.prisma.patch_company.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('returns dismissed rows with resolver names ordered by resolvedAt', async () => {
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      suggestionRow({
        resolved_at: new Date('2026-09-18T01:02:03.000Z'),
        resolved_by_user_id: 42
      })
    ])
    mocks.prisma.patch_company.findMany.mockResolvedValue(liveCompanies)
    mocks.prisma.user.findMany.mockResolvedValue([{ id: 42, name: 'alice' }])

    const result = await listCompanyMergeSuggestions('dismissed')

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        status: 'dismissed',
        names: ['Koei', 'KOEI Co., Ltd.'],
        resolvedAt: '2026-09-18T01:02:03.000Z',
        resolvedByUserId: 42,
        resolvedByName: 'alice'
      })
    )
    expect(mocks.prisma.company_merge_suggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'dismissed' },
        orderBy: [{ resolved_at: 'desc' }, { id: 'desc' }]
      })
    )
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [42] } },
      select: { id: true, name: true }
    })
    expectNoCompanyWrites()
  })

  it('returns accepted rows and omits resolver name when the user is gone', async () => {
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      suggestionRow({
        resolved_at: new Date('2026-09-19T04:05:06.000Z'),
        resolved_by_user_id: 7
      })
    ])
    mocks.prisma.patch_company.findMany.mockResolvedValue([liveCompanies[0]])
    mocks.prisma.user.findMany.mockResolvedValue([])

    const result = await listCompanyMergeSuggestions('accepted')

    expect(result.items[0].status).toBe('accepted')
    expect(result.items[0].resolvedAt).toBe('2026-09-19T04:05:06.000Z')
    expect(result.items[0].resolvedByUserId).toBe(7)
    expect(result.items[0]).not.toHaveProperty('resolvedByName')
    expect(result.items[0].participants[1]).toEqual({
      companyId: 2,
      name: null,
      aliases: [],
      introductionPreview: '',
      ownerId: null,
      officialWebsites: [],
      parentBrands: []
    })
    expect(mocks.prisma.company_merge_suggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'accepted' } })
    )
    expectNoCompanyWrites()
  })
})

describe('listCompanyMergeSuggestionsSchema', () => {
  it('defaults an omitted status to pending', () => {
    expect(listCompanyMergeSuggestionsSchema.parse({})).toEqual({
      status: 'pending'
    })
  })

  it('rejects an unknown status', () => {
    const result = listCompanyMergeSuggestionsSchema.safeParse({
      status: 'merged'
    })
    expect(result.success).toBe(false)
  })
})

describe('dismissCompanyMergeSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks a pending row dismissed and records the operator', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 1
    })

    await expect(dismissCompanyMergeSuggestion(7, 42)).resolves.toEqual({
      id: 7
    })

    expect(
      mocks.prisma.company_merge_suggestion.updateMany
    ).toHaveBeenCalledWith({
      where: { id: 7, status: 'pending' },
      data: {
        status: 'dismissed',
        resolved_at: expect.any(Date),
        resolved_by_user_id: 42
      }
    })
    expect(
      mocks.prisma.company_merge_suggestion.findUnique
    ).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('refuses a suggestion that is not pending any more', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 0
    })
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 7
    })

    await expect(dismissCompanyMergeSuggestion(7, 42)).resolves.toBe(
      '该建议已处理，无法重复驳回'
    )
    expectNoCompanyWrites()
  })

  it('reports a suggestion that does not exist', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 0
    })
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue(null)

    await expect(dismissCompanyMergeSuggestion(7, 42)).resolves.toBe(
      '未找到该会社合并建议'
    )
  })
})

describe('reopenCompanyMergeSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
  })

  it('moves a dismissed row back to pending on the same id', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 1
    })

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toEqual({ id: 9 })

    expect(
      mocks.prisma.company_merge_suggestion.updateMany
    ).toHaveBeenCalledWith({
      where: { id: 9, status: 'dismissed' },
      data: {
        status: 'pending',
        resolved_at: null,
        resolved_by_user_id: null
      }
    })
    expect(
      mocks.prisma.company_merge_suggestion.findUnique
    ).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('refuses a pending row', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 0
    })
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'pending'
    })

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '该建议仍待处理，无需重新打开'
    )
    expectNoCompanyWrites()
  })

  it('refuses an accepted row', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 0
    })
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'accepted'
    })

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '该建议已合并，无法重新打开'
    )
    expectNoCompanyWrites()
  })

  it('reports a suggestion that does not exist', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 0
    })
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue(null)

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '未找到该会社合并建议'
    )
    expectNoCompanyWrites()
  })

  it('lets detect refresh the reopened key instead of skipping it', async () => {
    mocks.prisma.company_merge_suggestion.updateMany.mockResolvedValue({
      count: 1
    })
    await expect(reopenCompanyMergeSuggestion(9)).resolves.toEqual({ id: 9 })

    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 9,
        folded_key: 'koei',
        status: 'pending',
        target_company_id: 1,
        source_company_ids: [2]
      }
    ])
    mocks.prisma.company_merge_suggestion.update.mockResolvedValue({ id: 9 })

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 0,
      updated: 1,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(mocks.prisma.company_merge_suggestion.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        target_company_id: 1,
        source_company_ids: [2]
      })
    })
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })
})
