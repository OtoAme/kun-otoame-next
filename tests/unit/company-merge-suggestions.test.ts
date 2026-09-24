import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn()
    },
    company_merge_pending_key: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    patch: {
      findMany: vi.fn()
    },
    user: {
      findMany: vi.fn()
    }
  }
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma)
  )
  return { prisma }
})

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))

import {
  detectCompanyMergeSuggestions,
  dismissCompanyMergeSuggestion,
  listCompanyMergeSuggestions,
  prunePendingSuggestionsWithMissingCompanies,
  reopenCompanyMergeSuggestion
} from '~/app/api/admin/company-merges/service'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import {
  CompanyMergeMemberKeyError,
  applyCompanyMergeSuggestionSchema,
  companyMergeEvidenceSchema,
  listCompanyMergeSuggestionsSchema,
  parseCompanyMergeEvidenceHits,
  toCandidateKey,
  toMemberKey
} from '~/validations/companyMerges'

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
        member_key: '1,2',
        candidate_key: 'suffix-unique-hit|1,2',
        evidence: { kind: 'suffix-unique-hit', foldedKey: 'koei', hits: [] },
        detected_at: expect.any(Date)
      }
    })
    expect(mocks.prisma.company_merge_pending_key.create).toHaveBeenCalledWith({
      data: { member_key: '1,2', suggestion_id: 1 }
    })
    expectNoCompanyWrites()
  })

  it('refreshes a legacy pending row with the same member_key and a null candidate_key', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 9,
        status: 'pending',
        member_key: '1,2',
        candidate_key: null,
        folded_key: 'something-else'
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
        source_company_ids: [2],
        member_key: '1,2',
        candidate_key: 'suffix-unique-hit|1,2',
        names: ['Koei', 'KOEI Co., Ltd.']
      })
    })
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expect(
      mocks.prisma.company_merge_pending_key.deleteMany
    ).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('leaves a smaller pending row alone when the member set grows', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.'),
      company(3, 'Koei Inc.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 9,
        status: 'pending',
        member_key: '1,2',
        candidate_key: 'suffix-unique-hit|1,2',
        folded_key: 'koei'
      }
    ])
    mocks.prisma.company_merge_suggestion.create.mockResolvedValue({ id: 11 })

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: expect.any(Array)
    })

    expect(mocks.prisma.company_merge_suggestion.update).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_suggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        member_key: '1,2,3',
        candidate_key: 'suffix-unique-hit|1,2,3',
        target_company_id: 1,
        source_company_ids: [2, 3]
      })
    })
    expectNoCompanyWrites()
  })

  it('leaves a dismissed member_key dismissed and ignores folded_key', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 9,
        folded_key: 'not-koei',
        status: 'dismissed',
        member_key: '1,2',
        candidate_key: null
      }
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
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([])

    const result = await detectCompanyMergeSuggestions()

    expect(result).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      durationMs: expect.any(Number),
      notes: []
    })
    expect(result.notes).not.toContain('建议写入失败，本次没有保存')
    expect(mocks.prisma.company_merge_suggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } })
    )
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

    expect(mocks.prisma.patch_company.findMany).toHaveBeenCalledTimes(2)
    expect(
      mocks.prisma.patch_company.findMany.mock.calls[0]?.[0]
    ).not.toHaveProperty('where')
    expect(mocks.prisma.patch_company.findMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ select: { id: true } })
    )
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
      resolvedByUserId: null,
      selectedCompanyIds: null,
      appliedTargetCompanyId: null,
      appliedSourceCompanyIds: null,
      resolutionSource: null,
      hits: []
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
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 7,
      status: 'pending',
      member_key: '1,2'
    })
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
        resolved_by_user_id: 42,
        resolution_source: 'operator-dismiss'
      }
    })
    expect(
      mocks.prisma.company_merge_pending_key.deleteMany
    ).toHaveBeenCalledWith({ where: { suggestion_id: 7 } })
    expectNoCompanyWrites()
  })

  it('refuses a suggestion that is not pending any more', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 7,
      status: 'dismissed',
      member_key: '1,2'
    })

    await expect(dismissCompanyMergeSuggestion(7, 42)).resolves.toBe(
      '该建议已处理，无法重复驳回'
    )
    expect(
      mocks.prisma.company_merge_suggestion.updateMany
    ).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('reports a suggestion that does not exist', async () => {
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

  it('moves a dismissed row back to pending and restores its pending-key', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'dismissed',
      member_key: '1,2',
      resolution_source: 'partial-merge-exclusion'
    })
    mocks.prisma.company_merge_pending_key.findUnique.mockResolvedValue(null)
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
        resolved_by_user_id: null,
        resolution_source: null
      }
    })
    expect(mocks.prisma.company_merge_pending_key.create).toHaveBeenCalledWith({
      data: { member_key: '1,2', suggestion_id: 9 }
    })
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('keeps the row dismissed when the member_key is already pending', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'dismissed',
      member_key: '407,408'
    })
    mocks.prisma.company_merge_pending_key.findUnique.mockResolvedValue({
      member_key: '407,408',
      suggestion_id: 50
    })

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '已有待处理的同一组会社'
    )
    expect(
      mocks.prisma.company_merge_suggestion.updateMany
    ).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_pending_key.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('refuses a pending row', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'pending',
      member_key: '1,2'
    })

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '该建议仍待处理，无需重新打开'
    )
    expectNoCompanyWrites()
  })

  it('refuses an accepted row', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'accepted',
      member_key: '1,2'
    })

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '该建议已合并，无法重新打开'
    )
    expectNoCompanyWrites()
  })

  it('reports a suggestion that does not exist', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue(null)

    await expect(reopenCompanyMergeSuggestion(9)).resolves.toBe(
      '未找到该会社合并建议'
    )
    expectNoCompanyWrites()
  })

  it('lets detect refresh the reopened key instead of skipping it', async () => {
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 9,
      status: 'dismissed',
      member_key: '1,2'
    })
    mocks.prisma.company_merge_pending_key.findUnique.mockResolvedValue(null)
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
        member_key: '1,2',
        candidate_key: 'suffix-unique-hit|1,2',
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

describe('company merge keys and evidence', () => {
  it('builds a stable source-pair candidate key and a member-specific other key', () => {
    expect(toMemberKey([409, 407, 407, 408])).toBe('407,408,409')
    expect(
      toCandidateKey({
        kind: 'source-pair',
        companyIds: [407, 408, 409],
        upstreamIds: ['vndb:p5101'],
        patchId: 814
      })
    ).toBe('source-pair|vndb:p5101|patch:814')
    expect(
      toCandidateKey({
        kind: 'source-pair',
        companyIds: [407, 409],
        upstreamIds: ['vndb:p5101'],
        patchId: 814
      })
    ).toBe(
      toCandidateKey({
        kind: 'source-pair',
        companyIds: [407, 408, 409],
        upstreamIds: ['vndb:p5101'],
        patchId: 814
      })
    )
    expect(
      toCandidateKey({ kind: 'suffix-unique-hit', companyIds: [407, 409] })
    ).toBe('suffix-unique-hit|407,409')
    expect(
      toCandidateKey({ kind: 'suffix-unique-hit', companyIds: [407, 408, 409] })
    ).not.toBe(
      toCandidateKey({ kind: 'suffix-unique-hit', companyIds: [407, 409] })
    )
  })

  it('rejects too few and too long member keys', () => {
    expect(() => toMemberKey([7])).toThrow(CompanyMergeMemberKeyError)
    expect(() => toMemberKey([7])).toThrow(
      expect.objectContaining({ code: 'too-few' })
    )
    const ids = Array.from({ length: 200 }, (_, index) => index + 1)
    expect(() => toMemberKey(ids)).toThrow(
      expect.objectContaining({ code: 'too-long' })
    )
  })

  it('accepts vndb alias and nextmoe display_name, and rejects the other fields', () => {
    const members = [407, 408, 409]
    expect(
      companyMergeEvidenceSchema(members).parse({
        hits: [
          { companyId: 408, source: 'vndb', field: 'alias', value: 'WINGALD' },
          {
            companyId: 407,
            source: 'nextmoe',
            field: 'display_name',
            value: 'Kotama Yuri'
          }
        ]
      }).hits
    ).toHaveLength(2)
    expect(
      companyMergeEvidenceSchema(members).safeParse({
        hits: [
          { companyId: 407, source: 'vndb', field: 'display_name', value: 'x' }
        ]
      }).success
    ).toBe(false)
    expect(
      companyMergeEvidenceSchema(members).safeParse({
        hits: [
          { companyId: 407, source: 'nextmoe', field: 'alias', value: 'x' }
        ]
      }).success
    ).toBe(false)
    expect(
      companyMergeEvidenceSchema(members).safeParse({
        hits: [{ companyId: 999, source: 'vndb', field: 'name', value: 'x' }]
      }).success
    ).toBe(false)
    expect(companyMergeEvidenceSchema(members).safeParse({}).success).toBe(
      false
    )
    expect(
      parseCompanyMergeEvidenceHits({ kind: 'suffix-unique-hit' }, members)
    ).toEqual([])
  })

  it('requires selectedCompanyIds on apply', () => {
    expect(
      applyCompanyMergeSuggestionSchema.safeParse({
        id: 1,
        name: 'Kotama Yuri',
        introductionFromCompanyId: 407
      }).success
    ).toBe(false)
    expect(
      applyCompanyMergeSuggestionSchema.parse({
        id: 1,
        name: 'Kotama Yuri',
        introductionFromCompanyId: 407,
        selectedCompanyIds: [409, 407],
        targetCompanyId: 408
      }).selectedCompanyIds
    ).toEqual([409, 407])
  })
})

describe('detect member_key decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.patch.findMany.mockResolvedValue([])
    mocks.prisma.company_merge_suggestion.create.mockResolvedValue({ id: 1 })
    mocks.prisma.company_merge_suggestion.update.mockResolvedValue({ id: 1 })
  })

  it('does not create 407+409 after the three-company member_key was dismissed', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(407, 'Koei'),
      company(408, 'KOEI Co., Ltd.'),
      company(409, 'Koei Inc.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 3,
        status: 'dismissed',
        member_key: '407,408,409',
        candidate_key: 'suffix-unique-hit|407,408,409'
      }
    ])

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual(
      expect.objectContaining({ created: 0, updated: 0, skipped: 1 })
    )
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_pending_key.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('does not rewrite a source-pair pending onto a dismissed pair', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(407, 'Kotama Yuri'),
      company(408, 'WINGALD'),
      company(409, 'Unrelated Studio')
    ])
    mocks.prisma.patch.findMany.mockResolvedValue([
      {
        id: 814,
        vndb_id: 'v1',
        bangumi_id: null,
        company: [{ company_id: 407 }, { company_id: 408 }, { company_id: 409 }]
      }
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'pending',
        member_key: '407,408,409',
        candidate_key: 'source-pair|vndb:p5101|patch:814'
      },
      {
        id: 2,
        status: 'dismissed',
        member_key: '407,408',
        candidate_key: null,
        resolution_source: 'operator-dismiss'
      }
    ])

    const result = await detectCompanyMergeSuggestions({
      loadVndbDevelopers: async () => [
        {
          id: 'p5101',
          name: 'Kotama Yuri',
          aliases: ['WINGALD'],
          type: 'co'
        }
      ],
      isNextmoeConfigured: () => false,
      sleep: async () => {}
    })

    expect(result).toEqual(
      expect.objectContaining({ created: 0, updated: 0, skipped: 1 })
    )
    expect(mocks.prisma.company_merge_suggestion.update).not.toHaveBeenCalled()
    expect(
      mocks.prisma.company_merge_pending_key.deleteMany
    ).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('keeps the old pending key when another pending already holds the target pair', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(407, 'Kotama Yuri'),
      company(408, 'WINGALD'),
      company(409, 'Unrelated Studio')
    ])
    mocks.prisma.patch.findMany.mockResolvedValue([
      {
        id: 814,
        vndb_id: 'v1',
        bangumi_id: null,
        company: [{ company_id: 407 }, { company_id: 408 }, { company_id: 409 }]
      }
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'pending',
        member_key: '407,408,409',
        candidate_key: 'source-pair|vndb:p5101|patch:814'
      },
      {
        id: 2,
        status: 'pending',
        member_key: '407,408',
        candidate_key: 'name-variant|407,408'
      }
    ])

    const result = await detectCompanyMergeSuggestions({
      loadVndbDevelopers: async () => [
        {
          id: 'p5101',
          name: 'Kotama Yuri',
          aliases: ['WINGALD'],
          type: 'co'
        }
      ],
      isNextmoeConfigured: () => false,
      sleep: async () => {}
    })

    expect(result.created).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.notes.join(' ')).toContain('407,408')
    expect(result.notes.join(' ')).toContain('#2')
    expect(mocks.prisma.company_merge_suggestion.update).not.toHaveBeenCalled()
    expect(
      mocks.prisma.company_merge_pending_key.deleteMany
    ).not.toHaveBeenCalled()
    expect(mocks.prisma.company_merge_pending_key.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })

  it('skips a member_key that is already accepted', async () => {
    mocks.prisma.patch_company.findMany.mockResolvedValue([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.')
    ])
    mocks.prisma.company_merge_suggestion.findMany.mockResolvedValue([
      {
        id: 4,
        status: 'accepted',
        member_key: '1,2',
        candidate_key: 'suffix-unique-hit|1,2'
      }
    ])

    await expect(detectCompanyMergeSuggestions()).resolves.toEqual(
      expect.objectContaining({ created: 0, updated: 0, skipped: 1 })
    )
    expect(mocks.prisma.company_merge_suggestion.create).not.toHaveBeenCalled()
    expectNoCompanyWrites()
  })
})

describe('prunePendingSuggestionsWithMissingCompanies', () => {
  const tx = mocks.prisma

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a pending suggestion when fewer than two companies remain', async () => {
    tx.company_merge_suggestion.findMany.mockImplementation(
      async (args?: { where?: { status?: string; member_key?: string } }) => {
        if (args?.where?.status === 'pending' && !args.where.member_key) {
          return [
            {
              id: 11,
              kind: 'name-variant',
              candidate_key: 'name-variant|6,442,482',
              target_company_id: 6,
              source_company_ids: [442, 482],
              names: [
                'Otomate',
                'オトメイト（PSP版）',
                'オトメイト（Otomate）'
              ],
              member_key: '6,442,482'
            }
          ]
        }
        return []
      }
    )
    tx.patch_company.findMany.mockResolvedValue([{ id: 6 }])

    await prunePendingSuggestionsWithMissingCompanies(tx as never)

    expect(tx.company_merge_pending_key.deleteMany).toHaveBeenCalledWith({
      where: { suggestion_id: 11 }
    })
    expect(tx.company_merge_suggestion.delete).toHaveBeenCalledWith({
      where: { id: 11 }
    })
    expect(tx.company_merge_suggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } })
    )
    expect(tx.company_merge_suggestion.update).not.toHaveBeenCalled()
  })

  it('shrinks a pending suggestion to the companies that still exist', async () => {
    tx.company_merge_suggestion.findMany.mockImplementation(
      async (args?: { where?: { member_key?: string; status?: string } }) => {
        if (args?.where?.member_key === '6,482') return []
        return [
          {
            id: 11,
            kind: 'name-variant',
            candidate_key: 'name-variant|6,442,482',
            target_company_id: 6,
            source_company_ids: [442, 482],
            names: ['Otomate', 'オトメイト（PSP版）', 'オトメイト（Otomate）'],
            member_key: '6,442,482'
          }
        ]
      }
    )
    tx.patch_company.findMany.mockResolvedValue([{ id: 6 }, { id: 482 }])

    await prunePendingSuggestionsWithMissingCompanies(tx as never)

    expect(tx.company_merge_suggestion.delete).not.toHaveBeenCalled()
    expect(tx.company_merge_suggestion.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        target_company_id: 6,
        source_company_ids: [482],
        names: ['Otomate', 'オトメイト（Otomate）'],
        member_key: '6,482',
        candidate_key: 'name-variant|6,482'
      }
    })
    expect(tx.company_merge_pending_key.create).toHaveBeenCalledWith({
      data: { member_key: '6,482', suggestion_id: 11 }
    })
  })

  it('deletes the stale pending row instead of stealing an occupied member key', async () => {
    tx.company_merge_suggestion.findMany.mockImplementation(
      async (args?: { where?: { member_key?: string; status?: string } }) => {
        if (args?.where?.member_key === '6,482') {
          return [{ id: 20, status: 'pending' }]
        }
        return [
          {
            id: 11,
            kind: 'name-variant',
            candidate_key: 'name-variant|6,442,482',
            target_company_id: 6,
            source_company_ids: [442, 482],
            names: ['Otomate', 'gone', 'still'],
            member_key: '6,442,482'
          }
        ]
      }
    )
    tx.patch_company.findMany.mockResolvedValue([{ id: 6 }, { id: 482 }])

    await prunePendingSuggestionsWithMissingCompanies(tx as never)

    expect(tx.company_merge_suggestion.delete).toHaveBeenCalledWith({
      where: { id: 11 }
    })
    expect(tx.company_merge_suggestion.update).not.toHaveBeenCalled()
    expect(tx.company_merge_pending_key.create).not.toHaveBeenCalled()
  })

  it('prunes during detect even when no new cluster is produced', async () => {
    tx.patch_company.findMany.mockResolvedValue([company(6, 'Otomate')])
    tx.company_merge_suggestion.findMany.mockImplementation(
      async (args?: { select?: { target_company_id?: boolean } }) => {
        if (args?.select?.target_company_id) {
          return [
            {
              id: 11,
              kind: 'name-variant',
              candidate_key: 'name-variant|6,442',
              target_company_id: 6,
              source_company_ids: [442],
              names: ['Otomate', 'オトメイト（PSP版）'],
              member_key: '6,442'
            }
          ]
        }
        return []
      }
    )
    tx.patch_company.findMany.mockImplementation(
      async (args?: { where?: { id?: { in?: number[] } } }) => {
        if (args?.where?.id?.in) return [{ id: 6 }]
        return [company(6, 'Otomate')]
      }
    )

    await detectCompanyMergeSuggestions()

    expect(tx.company_merge_suggestion.delete).toHaveBeenCalledWith({
      where: { id: 11 }
    })
  })
})
