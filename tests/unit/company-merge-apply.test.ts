import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanyDatabaseState,
  CompanyState
} from '~/scripts/companyCleanupFrozenContract'
import {
  applyActionsToCompanyDatabaseState,
  getCompanyOwnerRef,
  loadCompanyDatabaseState
} from '~/scripts/companyCleanupFrozenState'
import {
  CompanyMergeApplyError,
  applySingleCompanyMerge
} from '~/scripts/companyCleanupDashboardMerge'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    patch_company: {
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn()
    },
    patch_company_relation: { deleteMany: vi.fn(), createMany: vi.fn() },
    patch_company_external_id: { deleteMany: vi.fn(), createMany: vi.fn() },
    patch_company_name_identity: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn()
    },
    company_merge_suggestion: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn()
    }
  },
  invalidateCompanyCaches: vi.fn(),
  invalidatePatchContentCache: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
// 动态 import 也走这个替身: 否则用例会连上真的 Redis / Cloudflare 客户端。
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: mocks.invalidateCompanyCaches,
  invalidatePatchContentCache: mocks.invalidatePatchContentCache
}))

import { applyCompanyMergeSuggestion } from '~/app/api/admin/company-merges/service'

const KOEI_VNDB = { source: 'vndb', externalId: 'p473' }

const relation = (patchId: number) => ({
  patchId,
  patchUniqueId: `patch-${patchId}`,
  vndbId: `v${patchId}`,
  bangumiId: null
})

const patches: Record<
  number,
  { unique_id: string; vndb_id: string | null; bangumi_id: number | null }
> = Object.fromEntries(
  [10, 20, 30, 40].map((patchId) => [
    patchId,
    {
      unique_id: `patch-${patchId}`,
      vndb_id: `v${patchId}`,
      bangumi_id: null
    }
  ])
)

const company = (
  id: number,
  name: string,
  ownerUserId: number,
  overrides: Partial<CompanyState> = {}
): CompanyState => ({
  id,
  ref: `company-${id}`,
  name,
  normalizedName: normalizeCompanyValue(name),
  introduction: '',
  count: 0,
  primaryLanguage: [],
  sourceWebsites: [],
  parentBrands: [],
  aliases: [],
  ownerRef: getCompanyOwnerRef(ownerUserId),
  updated: '2026-09-17T00:00:00.000Z',
  externalIds: [],
  identities: [
    {
      kind: 'name',
      origin: 'authoritative',
      value: name,
      normalizedValue: normalizeCompanyValue(name),
      confirmedByRef: null
    }
  ],
  relations: [],
  ...overrides
})

/** Koei 的真实形状: 只差法人格后缀的两家会社, 外加一家无关会社。 */
const koeiState = (): CompanyDatabaseState => ({
  companies: [
    company(1, 'Koei', 42, {
      count: 2,
      introduction: 'Koei 的介绍',
      primaryLanguage: ['ja'],
      sourceWebsites: ['https://koei.example'],
      parentBrands: ['Koei Tecmo'],
      aliases: ['光栄'],
      externalIds: [KOEI_VNDB],
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: 'Koei',
          normalizedValue: 'koei',
          confirmedByRef: null
        },
        {
          kind: 'alias',
          origin: 'legacy',
          value: '光栄',
          normalizedValue: '光栄',
          confirmedByRef: null
        }
      ],
      relations: [relation(10), relation(20)]
    }),
    company(2, 'KOEI Co., Ltd.', 42, {
      count: 2,
      introduction: 'KOEI Co., Ltd. 的介绍',
      aliases: ['コーエー'],
      sourceWebsites: ['https://koei.co.jp'],
      externalIds: [{ source: 'steam', externalId: 'steam-2' }],
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: 'KOEI Co., Ltd.',
          normalizedValue: 'koei co., ltd.',
          confirmedByRef: null
        },
        {
          kind: 'alias',
          origin: 'legacy',
          value: 'コーエー',
          normalizedValue: 'コーエー',
          confirmedByRef: null
        }
      ],
      relations: [relation(20), relation(30)]
    }),
    company(3, 'Unrelated', 7, {
      count: 1,
      relations: [relation(40)]
    })
  ]
})

const OWNER_IDS = { 1: 42, 2: 42, 3: 7 }

interface FakeSuggestion {
  id: number
  status: string
  target_company_id: number
  source_company_ids: number[]
  resolved_at: Date | null
  resolved_by_user_id: number | null
  member_key?: string | null
  candidate_key?: string | null
  names?: string[]
  evidence?: unknown
  resolution_source?: string | null
  selected_company_ids?: number[] | null
  applied_source_company_ids?: number[] | null
  applied_target_company_id?: number | null
  kind?: string
  folded_key?: string
}

interface FakeIdentityRow {
  id: number
  kind: string
  origin: string
  value: string
  normalized_value: string
  confirmed_by_user_id: number | null
}

/**
 * 一个只存在于内存里的 `patch_company` 事务替身: 写入方法真的改行, 失败时整段
 * 回滚。这样「合并有没有走锁 + 整段替换」「失败是不是一行都没落」都能在单测里
 * 断言, 不用连库。
 */
const createFakeCompanyDatabase = (input: {
  state: CompanyDatabaseState
  ownerIds: Record<number, number>
  suggestions?: Array<
    Omit<FakeSuggestion, 'resolved_at' | 'resolved_by_user_id'>
  >
}) => {
  const rows = input.state.companies.map((entry) => ({
    id: entry.id,
    name: entry.name,
    normalized_name: entry.normalizedName,
    introduction: entry.introduction,
    count: entry.count,
    primary_language: [...entry.primaryLanguage],
    official_website: [...entry.sourceWebsites],
    parent_brand: [...entry.parentBrands],
    alias: [...entry.aliases],
    user_id: input.ownerIds[entry.id],
    updated: new Date(entry.updated),
    external_ids: entry.externalIds.map((external, index) => ({
      id: index + 1,
      source: external.source,
      external_id: external.externalId
    })),
    name_identities: entry.identities.map(
      (identity, index): FakeIdentityRow => ({
        id: index + 1,
        kind: identity.kind,
        origin: identity.origin,
        value: identity.value,
        normalized_value: identity.normalizedValue,
        confirmed_by_user_id: null
      })
    ),
    patch_relations: entry.relations.map((item, index) => ({
      id: index + 1,
      patch_id: item.patchId,
      patch: patches[item.patchId]
    }))
  }))

  const withSuggestionDefaults = (
    suggestion: Partial<FakeSuggestion> &
      Pick<
        FakeSuggestion,
        'id' | 'status' | 'target_company_id' | 'source_company_ids'
      >
  ): FakeSuggestion => ({
    resolved_at: null,
    resolved_by_user_id: null,
    member_key: null,
    candidate_key: null,
    names: [],
    evidence: { hits: [] },
    resolution_source: null,
    selected_company_ids: null,
    applied_source_company_ids: null,
    applied_target_company_id: null,
    kind: 'suffix-unique-hit',
    folded_key: '',
    ...suggestion
  })

  const suggestions = new Map<number, FakeSuggestion>(
    (input.suggestions ?? []).map((suggestion) => [
      suggestion.id,
      withSuggestionDefaults(suggestion)
    ])
  )
  const pendingKeys = new Map<string, number>()
  let nextSuggestionId = 1000

  let queryCount = 0
  let nextRowId = 100

  const findRow = (companyId: number) =>
    rows.find((row) => row.id === companyId)
  // 真实库靠语句级触发器维护 patch_company.count, 替身直接按关系行数重算。
  const recount = () => {
    for (const row of rows) row.count = row.patch_relations.length
  }

  const findSuggestion = (args: { where: { id: number; status?: string } }) => {
    const row = suggestions.get(args.where.id)
    if (!row) return null
    if (args.where.status && row.status !== args.where.status) return null
    return {
      id: row.id,
      kind: row.kind,
      target_company_id: row.target_company_id,
      source_company_ids: row.source_company_ids,
      names: row.names,
      evidence: row.evidence,
      member_key: row.member_key,
      status: row.status
    }
  }

  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    // 每次 assertCounterContract 都是「先查触发器, 再查计数一致性」
    $queryRaw: vi.fn().mockImplementation(() => {
      const result =
        queryCount % 2 === 0 ? counterTriggers : [{ mismatch_count: 0 }]
      queryCount += 1
      return Promise.resolve(result)
    }),
    patch_company: {
      findMany: vi.fn(
        (args?: { where?: { id?: { in?: number[] } } }): Promise<unknown> => {
          if (!args?.where) {
            return Promise.resolve(rows)
          }
          const ids = new Set(args.where.id?.in ?? [])
          return Promise.resolve(
            rows
              .filter((row) => ids.has(row.id))
              .map((row) => ({ id: row.id, user_id: row.user_id }))
          )
        }
      ),
      deleteMany: vi.fn((args: { where: { id: { in: number[] } } }) => {
        const ids = new Set(args.where.id.in)
        const removed = rows.filter(
          (row) => ids.has(row.id) && row.patch_relations.length === 0
        )
        for (const row of removed) rows.splice(rows.indexOf(row), 1)
        return Promise.resolve({ count: removed.length })
      }),
      update: vi.fn(
        (args: {
          where: { id: number }
          data: {
            name: string
            normalized_name: string
            introduction: string
            primary_language: string[]
            official_website: string[]
            parent_brand: string[]
            alias: string[]
            user_id: number
          }
        }) => {
          const row = findRow(args.where.id)
          if (!row) throw new Error('fake database: unknown company row')
          Object.assign(row, {
            name: args.data.name,
            normalized_name: args.data.normalized_name,
            introduction: args.data.introduction,
            primary_language: args.data.primary_language,
            official_website: args.data.official_website,
            parent_brand: args.data.parent_brand,
            alias: args.data.alias,
            user_id: args.data.user_id,
            updated: new Date()
          })
          return Promise.resolve(row)
        }
      )
    },
    patch_company_relation: {
      deleteMany: vi.fn((args: { where: { company_id: { in: number[] } } }) => {
        const ids = new Set(args.where.company_id.in)
        let count = 0
        for (const row of rows) {
          if (!ids.has(row.id)) continue
          count += row.patch_relations.length
          row.patch_relations = []
        }
        recount()
        return Promise.resolve({ count })
      }),
      createMany: vi.fn(
        (args: { data: Array<{ company_id: number; patch_id: number }> }) => {
          for (const entry of args.data) {
            const row = findRow(entry.company_id)!
            row.patch_relations.push({
              id: (nextRowId += 1),
              patch_id: entry.patch_id,
              patch: patches[entry.patch_id]
            })
          }
          recount()
          return Promise.resolve({ count: args.data.length })
        }
      )
    },
    patch_company_external_id: {
      deleteMany: vi.fn((args: { where: { company_id: { in: number[] } } }) => {
        const ids = new Set(args.where.company_id.in)
        let count = 0
        for (const row of rows) {
          if (!ids.has(row.id)) continue
          count += row.external_ids.length
          row.external_ids = []
        }
        return Promise.resolve({ count })
      }),
      createMany: vi.fn(
        (args: {
          data: Array<{
            company_id: number
            source: string
            external_id: string
          }>
        }) => {
          for (const entry of args.data) {
            findRow(entry.company_id)!.external_ids.push({
              id: (nextRowId += 1),
              source: entry.source,
              external_id: entry.external_id
            })
          }
          return Promise.resolve({ count: args.data.length })
        }
      )
    },
    patch_company_name_identity: {
      findMany: vi.fn((args: { where: { company_id: { in: number[] } } }) => {
        const ids = new Set(args.where.company_id.in)
        return Promise.resolve(
          rows
            .filter((row) => ids.has(row.id))
            .flatMap((row) => row.name_identities)
            .filter((identity) => identity.confirmed_by_user_id !== null)
            .map((identity) => ({
              confirmed_by_user_id: identity.confirmed_by_user_id
            }))
        )
      }),
      deleteMany: vi.fn((args: { where: { company_id: { in: number[] } } }) => {
        const ids = new Set(args.where.company_id.in)
        let count = 0
        for (const row of rows) {
          if (!ids.has(row.id)) continue
          count += row.name_identities.length
          row.name_identities = []
        }
        return Promise.resolve({ count })
      }),
      createMany: vi.fn(
        (args: {
          data: Array<{
            company_id: number
            kind: string
            origin: string
            value: string
            normalized_value: string
            confirmed_by_user_id: number | null
          }>
        }) => {
          for (const entry of args.data) {
            findRow(entry.company_id)!.name_identities.push({
              id: (nextRowId += 1),
              ...entry
            })
          }
          return Promise.resolve({ count: args.data.length })
        }
      )
    },
    company_merge_suggestion: {
      findFirst: vi.fn((args: { where: { id: number; status?: string } }) =>
        Promise.resolve(findSuggestion(args))
      ),
      updateMany: vi.fn(
        (args: {
          where: { id: number; status?: string }
          data: Partial<FakeSuggestion>
        }) => {
          const row = suggestions.get(args.where.id)
          if (!row || (args.where.status && row.status !== args.where.status)) {
            return Promise.resolve({ count: 0 })
          }
          Object.assign(row, args.data)
          return Promise.resolve({ count: 1 })
        }
      ),
      update: vi.fn(
        (args: { where: { id: number }; data: Partial<FakeSuggestion> }) => {
          const row = suggestions.get(args.where.id)
          if (!row) throw new Error('fake database: unknown suggestion')
          Object.assign(row, args.data)
          return Promise.resolve(row)
        }
      ),
      create: vi.fn((args: { data: Partial<FakeSuggestion> }) => {
        const id = args.data.id ?? (nextSuggestionId += 1)
        const row = withSuggestionDefaults({
          id,
          status: args.data.status ?? 'pending',
          target_company_id: args.data.target_company_id ?? 0,
          source_company_ids: args.data.source_company_ids ?? [],
          ...args.data
        })
        suggestions.set(id, row)
        return Promise.resolve(row)
      }),
      findMany: vi.fn(
        (args?: {
          where?: {
            member_key?: string
            status?: string | { in?: string[] }
          }
        }) => {
          const memberKey = args?.where?.member_key
          const status = args?.where?.status
          return Promise.resolve(
            [...suggestions.values()].filter((row) => {
              if (memberKey && row.member_key !== memberKey) return false
              if (typeof status === 'string' && row.status !== status) {
                return false
              }
              if (
                status &&
                typeof status === 'object' &&
                status.in &&
                !status.in.includes(row.status)
              ) {
                return false
              }
              return true
            })
          )
        }
      ),
      findUnique: vi.fn((args: { where: { id: number } }) =>
        Promise.resolve(suggestions.get(args.where.id) ?? null)
      ),
      delete: vi.fn((args: { where: { id: number } }) => {
        const row = suggestions.get(args.where.id)
        if (!row) throw new Error('fake database: unknown suggestion')
        suggestions.delete(args.where.id)
        return Promise.resolve(row)
      })
    },
    company_merge_pending_key: {
      deleteMany: vi.fn(
        (args: { where: { suggestion_id?: number; member_key?: string } }) => {
          let count = 0
          for (const [memberKey, suggestionId] of [...pendingKeys.entries()]) {
            if (
              args.where.suggestion_id !== undefined &&
              suggestionId !== args.where.suggestion_id
            ) {
              continue
            }
            if (
              args.where.member_key !== undefined &&
              memberKey !== args.where.member_key
            ) {
              continue
            }
            pendingKeys.delete(memberKey)
            count += 1
          }
          return Promise.resolve({ count })
        }
      ),
      create: vi.fn(
        (args: { data: { member_key: string; suggestion_id: number } }) => {
          for (const [memberKey, suggestionId] of pendingKeys) {
            if (
              memberKey === args.data.member_key ||
              suggestionId === args.data.suggestion_id
            ) {
              throw Object.assign(new Error('Unique constraint failed'), {
                code: 'P2002'
              })
            }
          }
          pendingKeys.set(args.data.member_key, args.data.suggestion_id)
          return Promise.resolve(args.data)
        }
      ),
      findUnique: vi.fn((args: { where: { member_key: string } }) => {
        const suggestionId = pendingKeys.get(args.where.member_key)
        return Promise.resolve(
          suggestionId === undefined
            ? null
            : {
                member_key: args.where.member_key,
                suggestion_id: suggestionId
              }
        )
      })
    }
  }

  const $transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => {
      const rowSnapshot = structuredClone(rows)
      const suggestionSnapshot = [...suggestions.entries()].map(
        ([id, row]) => [id, structuredClone(row)] as const
      )
      const keySnapshot = [...pendingKeys.entries()]
      try {
        return await callback(tx)
      } catch (error) {
        rows.splice(0, rows.length, ...structuredClone(rowSnapshot))
        suggestions.clear()
        for (const [id, row] of suggestionSnapshot) suggestions.set(id, row)
        pendingKeys.clear()
        for (const [memberKey, suggestionId] of keySnapshot) {
          pendingKeys.set(memberKey, suggestionId)
        }
        throw error
      }
    }
  )

  return {
    tx,
    $transaction,
    suggestions,
    pendingKeys,
    findSuggestion,
    readRows: () => rows,
    readState: () =>
      loadCompanyDatabaseState(
        tx as unknown as Parameters<typeof loadCompanyDatabaseState>[0]
      )
  }
}

const counterTriggers = [
  {
    trigger_name: 'patch_company_count_trg_ins',
    enabled: 'O',
    old_table: null,
    new_table: 'new_rows',
    is_statement: true,
    trigger_type: 4,
    function_name: 'patch_company_count_trg_ins',
    function_source: `
DECLARE counter record;
BEGIN
  FOR counter IN SELECT company_id AS parent_id, COUNT(*)::integer AS delta FROM new_rows GROUP BY company_id ORDER BY company_id
  LOOP UPDATE public.patch_company SET count = count + counter.delta WHERE id = counter.parent_id; END LOOP;
  RETURN NULL;
END`,
    function_is_trigger: true,
    function_argument_count: 0,
    function_kind: 'f'
  },
  {
    trigger_name: 'patch_company_count_trg_del',
    enabled: 'O',
    old_table: 'old_rows',
    new_table: null,
    is_statement: true,
    trigger_type: 8,
    function_name: 'patch_company_count_trg_del',
    function_source: `
DECLARE counter record;
BEGIN
  FOR counter IN SELECT company_id AS parent_id, COUNT(*)::integer AS delta FROM old_rows GROUP BY company_id ORDER BY company_id
  LOOP UPDATE public.patch_company SET count = GREATEST(count - counter.delta, 0) WHERE id = counter.parent_id; END LOOP;
  RETURN NULL;
END`,
    function_is_trigger: true,
    function_argument_count: 0,
    function_kind: 'f'
  },
  {
    trigger_name: 'patch_company_count_trg_upd',
    enabled: 'O',
    old_table: 'old_rows',
    new_table: 'new_rows',
    is_statement: true,
    trigger_type: 16,
    function_name: 'patch_company_count_trg_upd',
    function_source: `
DECLARE counter record;
BEGIN
  FOR counter IN
    SELECT parent_id, SUM(delta)::integer AS delta
    FROM (
      SELECT old_row.company_id AS parent_id, -1 AS delta FROM old_rows old_row JOIN new_rows new_row USING (id) WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
      UNION ALL
      SELECT new_row.company_id AS parent_id, 1 AS delta FROM old_rows old_row JOIN new_rows new_row USING (id) WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
    ) changes GROUP BY parent_id ORDER BY parent_id
  LOOP UPDATE public.patch_company SET count = GREATEST(count + counter.delta, 0) WHERE id = counter.parent_id; END LOOP;
  RETURN NULL;
END`,
    function_is_trigger: true,
    function_argument_count: 0,
    function_kind: 'f'
  }
]

const mergeInput = {
  targetCompanyId: 1,
  sourceCompanyIds: [2],
  name: 'Koei',
  ownerFromCompanyId: 1,
  introductionFromCompanyId: 2,
  reason: 'dashboard merge'
}

const createDatabase = (state = koeiState()) =>
  createFakeCompanyDatabase({ state, ownerIds: OWNER_IDS })

const runMerge = (
  database: ReturnType<typeof createDatabase>,
  overrides: Partial<Parameters<typeof applySingleCompanyMerge>[0]> = {}
) =>
  applySingleCompanyMerge({
    db: { $transaction: database.$transaction } as never,
    ...mergeInput,
    ...overrides
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('company merge state transition', () => {
  it('folds a legal-suffix duplicate into one company with both names and the relation union', () => {
    const before = koeiState()
    const snapshot = structuredClone(before)

    const result = applyActionsToCompanyDatabaseState(
      before,
      [],
      [
        {
          kind: 'manual',
          targetCompanyId: 1,
          sourceCompanyIds: [2],
          ownerFromCompanyId: 1,
          introductionFromCompanyId: 1,
          reason: 'reviewed duplicate'
        }
      ],
      []
    )

    expect(result.state.companies.map((row) => row.id)).toEqual([1, 3])
    const target = result.state.companies[0]
    expect(target.name).toBe('Koei')
    expect(target.aliases).toEqual(
      expect.arrayContaining(['KOEI Co., Ltd.', 'コーエー', '光栄'])
    )
    expect(target.relations.map((item) => item.patchId)).toEqual([10, 20, 30])
    expect(target.count).toBe(3)
    // 入参状态只被读, 没有被就地改写
    expect(before).toEqual(snapshot)
  })
})

describe('applySingleCompanyMerge', () => {
  it('writes the merge through the locked frozen writer and verifies the post-state', async () => {
    const database = createDatabase()

    await expect(runMerge(database)).resolves.toEqual({
      databaseStatus: 'applied',
      affectedCompanyIds: [1, 2],
      patchUniqueIds: ['patch-10', 'patch-20', 'patch-30']
    })

    const state = await database.readState()
    expect(state.companies.map((row) => row.id)).toEqual([1, 3])
    const target = state.companies[0]
    expect(target.name).toBe('Koei')
    expect(target.aliases).toEqual(
      expect.arrayContaining(['KOEI Co., Ltd.', 'コーエー', '光栄'])
    )
    expect(target.relations.map((item) => item.patchId)).toEqual([10, 20, 30])
    expect(target.count).toBe(3)
    expect(target.introduction).toBe('KOEI Co., Ltd. 的介绍')
    expect(target.sourceWebsites).toEqual([
      'https://koei.co.jp',
      'https://koei.example'
    ])
    expect(target.parentBrands).toEqual(['Koei Tecmo'])
    expect(target.externalIds).toEqual(
      expect.arrayContaining([
        KOEI_VNDB,
        { source: 'steam', externalId: 'steam-2' }
      ])
    )

    // 锁与整段替换都必须真的走到
    expect(
      database.tx.$executeRawUnsafe.mock.calls.map(([sql]) => sql)
    ).toEqual([
      "SET LOCAL lock_timeout = '10000ms'",
      "SET LOCAL statement_timeout = '120000ms'",
      'LOCK TABLE public.patch_company_relation IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.patch_company IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.patch_company_external_id IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.patch_company_name_identity IN SHARE ROW EXCLUSIVE MODE'
    ])
    expect(database.tx.patch_company_relation.deleteMany).toHaveBeenCalledWith({
      where: { company_id: { in: [1, 2] } }
    })
    expect(database.tx.patch_company.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [2] }, patch_relations: { none: {} } }
    })
    expect(database.tx.patch_company_relation.createMany).toHaveBeenCalledWith({
      data: [
        { company_id: 1, patch_id: 10 },
        { company_id: 1, patch_id: 20 },
        { company_id: 1, patch_id: 30 }
      ]
    })
  })

  it('keeps the previous main name as an alias when another participant name wins', async () => {
    const database = createDatabase()

    const result = await runMerge(database, {
      targetCompanyId: 2,
      sourceCompanyIds: [1],
      name: 'Koei',
      ownerFromCompanyId: 1,
      introductionFromCompanyId: 1
    })

    expect(result.affectedCompanyIds).toEqual([2, 1])
    expect([...result.patchUniqueIds].sort()).toEqual([
      'patch-10',
      'patch-20',
      'patch-30'
    ])

    const state = await database.readState()
    expect(state.companies.map((row) => row.id)).toEqual([2, 3])
    const target = state.companies[0]
    expect(target.name).toBe('Koei')
    expect(target.normalizedName).toBe('koei')
    expect(target.aliases).toEqual(
      expect.arrayContaining(['KOEI Co., Ltd.', 'コーエー', '光栄'])
    )
    // 主名身份只有一条: 不会同时留一条同值的别名身份
    expect(
      target.identities.filter(
        (identity) => identity.normalizedValue === 'koei'
      )
    ).toEqual([
      {
        kind: 'name',
        origin: 'authoritative',
        value: 'Koei',
        normalizedValue: 'koei',
        confirmedByRef: null
      }
    ])
    // 源会社行被删掉, 旧 URL 直接 404
    expect(state.companies.some((row) => row.id === 1)).toBe(false)
  })

  it('assigns the selected name and its original owner onto the smallest company id', async () => {
    const database = createFakeCompanyDatabase({
      state: koeiState(),
      ownerIds: { 1: 10, 2: 20, 3: 7 }
    })

    await applySingleCompanyMerge({
      db: { $transaction: database.$transaction } as never,
      targetCompanyId: 1,
      sourceCompanyIds: [2],
      name: 'KOEI Co., Ltd.',
      deriveOwnerFromSelectedName: true,
      introductionFromCompanyId: 2,
      reason: 'dashboard merge'
    })

    const primary = database.readRows().find((row) => row.id === 1)
    expect(primary?.name).toBe('KOEI Co., Ltd.')
    expect(primary?.user_id).toBe(20)
    expect(primary?.alias).toEqual(
      expect.arrayContaining(['Koei', 'コーエー', '光栄'])
    )
    expect(database.readRows().some((row) => row.id === 2)).toBe(false)
  })

  it('reports already-applied without writing when the merge already happened', async () => {
    const applied = applyActionsToCompanyDatabaseState(
      koeiState(),
      [],
      [
        {
          kind: 'manual',
          targetCompanyId: 1,
          sourceCompanyIds: [2],
          ownerFromCompanyId: 1,
          introductionFromCompanyId: 1,
          reason: 'first attempt'
        }
      ],
      []
    ).state
    const database = createDatabase(applied)

    await expect(runMerge(database)).resolves.toEqual({
      databaseStatus: 'already-applied',
      affectedCompanyIds: [1, 2],
      patchUniqueIds: ['patch-10', 'patch-20', 'patch-30']
    })
    expect(database.tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
    expect(database.tx.patch_company.update).not.toHaveBeenCalled()
  })

  it('refuses an external id conflict and leaves every row untouched', async () => {
    const state = koeiState()
    // 伪造的坏数据: 源会社与无关会社抢同一个 vndb id (真实库有唯一约束挡着)。
    state.companies[1].externalIds = [{ source: 'vndb', externalId: 'p999' }]
    state.companies[2].externalIds = [{ source: 'vndb', externalId: 'p999' }]
    const database = createDatabase(state)
    const before = structuredClone(await database.readState())

    const error = await runMerge(database).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CompanyMergeApplyError)
    expect((error as Error).message).toContain('合并后的会社身份与现有数据冲突')
    expect(await database.readState()).toEqual(before)
    expect(database.tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
    expect(database.tx.patch_company.update).not.toHaveBeenCalled()
  })

  it('refuses a main name that another company already owns', async () => {
    const state = koeiState()
    // #1 的别名正是 #3 的主名: 旧写法会撞上 normalized_name 唯一约束
    state.companies[2] = company(3, '光栄', 7, {
      count: 1,
      relations: [relation(40)]
    })
    const database = createDatabase(state)

    await expect(runMerge(database, { name: '光栄' })).rejects.toThrow(
      '主名「光栄」已经是会社 #3 的名称'
    )
    expect(database.tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
  })

  it('refuses a main name no participant carries', async () => {
    const database = createDatabase()

    await expect(runMerge(database, { name: 'Koei Tecmo' })).rejects.toThrow(
      '不是本次合并参与会社的名称或别名'
    )
    expect(database.tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
  })

  it('reports drift and writes nothing when a participant vanished', async () => {
    const database = createDatabase()
    // 检测之后存续会社被改了名 (身份行跟着投影走)、源会社被别的合并吃掉: 这一簇整体过期
    const targetRow = database.readRows().find((row) => row.id === 1)!
    targetRow.name = 'Koei Tecmo Holdings'
    targetRow.normalized_name = 'koei tecmo holdings'
    targetRow.alias = []
    targetRow.name_identities = [
      {
        id: 99,
        kind: 'name',
        origin: 'authoritative',
        value: 'Koei Tecmo Holdings',
        normalized_value: 'koei tecmo holdings',
        confirmed_by_user_id: null
      }
    ]
    const rows = database.readRows()
    rows.splice(
      rows.findIndex((row) => row.id === 2),
      1
    )

    await expect(runMerge(database)).rejects.toThrow(
      '会社 #2 已不存在，本次合并未执行，请刷新列表后重试'
    )
    expect(database.tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
    expect(database.tx.patch_company.update).not.toHaveBeenCalled()
  })

  it('refuses a source list that repeats the surviving company', async () => {
    const database = createDatabase()

    await expect(
      runMerge(database, { sourceCompanyIds: [1, 2] })
    ).rejects.toThrow('合并需要至少一家被并走的会社')
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('rolls the company writes back when work in the same transaction fails', async () => {
    const database = createDatabase()
    const before = structuredClone(await database.readState())

    await expect(
      runMerge(database, {
        hooks: {
          afterApply: async () => {
            throw new Error('建议行没写成功')
          }
        }
      })
    ).rejects.toThrow('建议行没写成功')

    // 写入确实发生过, 但整段事务回滚, 数据仍是最初的样子
    expect(database.tx.patch_company_relation.deleteMany).toHaveBeenCalled()
    expect(database.tx.patch_company.deleteMany).toHaveBeenCalled()
    expect(await database.readState()).toEqual(before)
  })
})

describe('applyCompanyMergeSuggestion', () => {
  const suggestion = {
    id: 7,
    status: 'pending',
    target_company_id: 1,
    source_company_ids: [2]
  }

  const applyInput = {
    id: 7,
    targetCompanyId: 1,
    selectedCompanyIds: [1, 2],
    name: 'Koei',
    ownerFromCompanyId: 1,
    introductionFromCompanyId: 2
  }

  it('merges the cluster and accepts the suggestion inside the same transaction', async () => {
    const database = createDatabase()
    database.suggestions.set(7, {
      ...suggestion,
      resolved_at: null,
      resolved_by_user_id: null
    })
    mocks.prisma.$transaction = database.$transaction
    mocks.prisma.company_merge_suggestion.findFirst.mockImplementation(
      database.findSuggestion
    )

    await expect(applyCompanyMergeSuggestion(applyInput, 42)).resolves.toEqual({
      id: 7,
      targetCompanyId: 1,
      databaseStatus: 'applied'
    })

    expect(database.suggestions.get(7)).toMatchObject({
      status: 'accepted',
      resolved_by_user_id: 42,
      resolved_at: expect.any(Date)
    })
    const state = await database.readState()
    expect(state.companies.map((row) => row.id)).toEqual([1, 3])
    // 存续会社与被并走的会社, 以及两家会社身上的作品, 缓存都要失效
    expect(
      mocks.invalidateCompanyCaches.mock.calls
        .map(([companyId]) => companyId)
        .sort()
    ).toEqual([1, 2])
    expect(mocks.invalidatePatchContentCache).toHaveBeenCalledWith('patch-10')
  })

  it('ignores a larger suggested target and keeps the smallest company id', async () => {
    const database = createFakeCompanyDatabase({
      state: koeiState(),
      ownerIds: { 1: 10, 2: 20, 3: 7 }
    })
    database.suggestions.set(7, {
      id: 7,
      status: 'pending',
      target_company_id: 2,
      source_company_ids: [1],
      resolved_at: null,
      resolved_by_user_id: null
    })
    mocks.prisma.$transaction = database.$transaction
    mocks.prisma.company_merge_suggestion.findFirst.mockImplementation(
      database.findSuggestion
    )

    await expect(
      applyCompanyMergeSuggestion(
        {
          id: 7,
          targetCompanyId: 2,
          selectedCompanyIds: [1, 2],
          name: 'KOEI Co., Ltd.',
          ownerFromCompanyId: 2,
          introductionFromCompanyId: 2
        },
        42
      )
    ).resolves.toEqual({
      id: 7,
      targetCompanyId: 1,
      databaseStatus: 'applied'
    })

    const primary = database.readRows().find((row) => row.id === 1)
    expect(primary?.name).toBe('KOEI Co., Ltd.')
    expect(primary?.user_id).toBe(20)
    expect(database.readRows().some((row) => row.id === 2)).toBe(false)
  })

  it('leaves the suggestion pending and the companies untouched when the merge fails', async () => {
    const database = createDatabase()
    database.suggestions.set(7, {
      ...suggestion,
      resolved_at: null,
      resolved_by_user_id: null
    })
    const before = structuredClone(await database.readState())
    database.tx.patch_company_name_identity.createMany.mockRejectedValueOnce(
      new Error('identity write failed')
    )
    mocks.prisma.$transaction = database.$transaction
    mocks.prisma.company_merge_suggestion.findFirst.mockImplementation(
      database.findSuggestion
    )

    await expect(applyCompanyMergeSuggestion(applyInput, 42)).resolves.toBe(
      '合并失败，会社数据未改动，请刷新列表后重试'
    )

    expect(
      database.tx.company_merge_suggestion.updateMany
    ).not.toHaveBeenCalled()
    expect(database.suggestions.get(7)?.status).toBe('pending')
    expect(await database.readState()).toEqual(before)
    expect(mocks.invalidateCompanyCaches).not.toHaveBeenCalled()
  })

  it('refuses a cluster that changed inside the transaction', async () => {
    const database = createDatabase()
    // 事务外读到的是 {1,2}, 事务内那一行已经被检测刷新成 {1,2,4}
    database.suggestions.set(7, {
      id: 7,
      status: 'pending',
      target_company_id: 1,
      source_company_ids: [2, 4],
      resolved_at: null,
      resolved_by_user_id: null
    })
    const before = structuredClone(await database.readState())
    mocks.prisma.$transaction = database.$transaction
    mocks.prisma.company_merge_suggestion.findFirst.mockResolvedValue({
      id: 7,
      target_company_id: 1,
      source_company_ids: [2]
    })

    await expect(applyCompanyMergeSuggestion(applyInput, 42)).resolves.toBe(
      '该建议涉及的会社已经变化，请刷新列表后重新确认'
    )

    expect(database.tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
    expect(await database.readState()).toEqual(before)
    expect(database.suggestions.get(7)?.status).toBe('pending')
  })

  it('reports a suggestion that is no longer pending and one that never existed', async () => {
    mocks.prisma.company_merge_suggestion.findFirst.mockResolvedValue(null)
    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue({
      id: 7
    })

    await expect(applyCompanyMergeSuggestion(applyInput, 42)).resolves.toBe(
      '该建议已处理，无法再次合并'
    )

    mocks.prisma.company_merge_suggestion.findUnique.mockResolvedValue(null)

    await expect(applyCompanyMergeSuggestion(applyInput, 42)).resolves.toBe(
      '未找到该会社合并建议'
    )
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('takes the merge-queue lock before company table locks', async () => {
    const database = createDatabase()
    database.suggestions.set(7, {
      ...suggestion,
      resolved_at: null,
      resolved_by_user_id: null
    })
    mocks.prisma.$transaction = database.$transaction
    mocks.prisma.company_merge_suggestion.findFirst.mockImplementation(
      database.findSuggestion
    )

    await applyCompanyMergeSuggestion(applyInput, 42)

    const statements = database.tx.$executeRawUnsafe.mock.calls.map(([sql]) =>
      String(sql)
    )
    const advisory = statements.findIndex((sql) =>
      sql.includes("'company-merge-queue'")
    )
    const tableLock = statements.findIndex((sql) => sql.includes('LOCK TABLE'))
    expect(advisory).toBeGreaterThanOrEqual(0)
    expect(advisory).toBeLessThan(tableLock)
  })
})

describe('applyCompanyMergeSuggestion subset', () => {
  const parentEvidence = {
    kind: 'source-pair',
    patchId: 814,
    upstreamIds: ['vndb:p5101'],
    hits: [
      { companyId: 407, source: 'vndb', field: 'name', value: 'Kotama Yuri' },
      { companyId: 408, source: 'vndb', field: 'alias', value: 'WINGALD' },
      { companyId: 409, source: 'vndb', field: 'original', value: '小珠ゆり' }
    ]
  }

  const subsetState = (): CompanyDatabaseState => ({
    companies: [
      company(407, 'Kotama Yuri', 11, {
        count: 1,
        introduction: 'yuri intro',
        relations: [relation(10)]
      }),
      company(408, 'WINGALD', 99, {
        count: 1,
        introduction: 'wingald intro',
        sourceWebsites: ['https://wingald.example'],
        relations: [relation(20)]
      }),
      company(409, '小珠ゆり', 22, {
        count: 1,
        introduction: 'kozue intro',
        aliases: ['小珠'],
        relations: [relation(30)]
      })
    ]
  })

  const wire = (
    database: ReturnType<typeof createFakeCompanyDatabase>,
    extra: Partial<FakeSuggestion> = {}
  ) => {
    database.suggestions.set(7, {
      id: 7,
      status: 'pending',
      kind: 'source-pair',
      target_company_id: 407,
      source_company_ids: [408, 409],
      names: ['Kotama Yuri', 'WINGALD', '小珠ゆり'],
      member_key: '407,408,409',
      candidate_key: 'source-pair|vndb:p5101|patch:814',
      evidence: parentEvidence,
      folded_key: 'vndb:p5101',
      resolved_at: null,
      resolved_by_user_id: null,
      ...extra
    })
    mocks.prisma.$transaction = database.$transaction
    mocks.prisma.company_merge_suggestion.findFirst.mockImplementation(
      database.findSuggestion
    )
  }

  const selectedInput = {
    id: 7,
    targetCompanyId: 408,
    selectedCompanyIds: [407, 409],
    name: '小珠ゆり',
    ownerFromCompanyId: 99,
    introductionFromCompanyId: 409
  }

  const rowsWithKey = (
    database: ReturnType<typeof createFakeCompanyDatabase>,
    memberKey: string
  ) =>
    [...database.suggestions.values()].filter(
      (row) => row.member_key === memberKey
    )

  it('merges only the checked companies and leaves the unchecked row untouched', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)

    await expect(
      applyCompanyMergeSuggestion(selectedInput, 42)
    ).resolves.toEqual({
      id: 7,
      targetCompanyId: 407,
      databaseStatus: 'applied'
    })

    const rows = database.readRows()
    expect(
      rows.map((row) => row.id).sort((left, right) => left - right)
    ).toEqual([407, 408])
    const survivor = rows.find((row) => row.id === 407)
    const untouched = rows.find((row) => row.id === 408)
    expect(survivor?.name).toBe('小珠ゆり')
    expect(survivor?.user_id).toBe(22)
    expect(survivor?.introduction).toBe('kozue intro')
    expect(survivor?.official_website).not.toContain('https://wingald.example')
    expect(survivor?.alias).toEqual(
      expect.arrayContaining(['Kotama Yuri', '小珠'])
    )
    expect(
      survivor?.patch_relations.map((item) => item.patch_id).sort()
    ).toEqual([10, 30])
    expect(untouched).toMatchObject({
      name: 'WINGALD',
      user_id: 99,
      introduction: 'wingald intro',
      count: 1,
      official_website: ['https://wingald.example']
    })
    expect(untouched?.patch_relations.map((item) => item.patch_id)).toEqual([
      20
    ])

    expect(database.suggestions.get(7)).toMatchObject({
      status: 'accepted',
      resolution_source: 'operator-merge',
      selected_company_ids: [407, 409],
      applied_target_company_id: 407,
      applied_source_company_ids: [409],
      member_key: '407,408,409'
    })
    expect(rowsWithKey(database, '407,408')).toEqual([
      expect.objectContaining({
        status: 'dismissed',
        resolution_source: 'partial-merge-exclusion',
        candidate_key: null,
        member_key: '407,408',
        names: ['Kotama Yuri', 'WINGALD']
      })
    ])
    expect(database.pendingKeys.has('407,408')).toBe(false)
    expect(rowsWithKey(database, '407,408')[0]?.evidence).toMatchObject({
      resolutionSource: 'partial-merge-exclusion',
      parentSuggestionId: 7,
      patchId: 814,
      upstreamIds: ['vndb:p5101'],
      hits: [
        { companyId: 407, source: 'vndb', field: 'name', value: 'Kotama Yuri' },
        { companyId: 408, source: 'vndb', field: 'alias', value: 'WINGALD' }
      ]
    })

    expect(
      mocks.invalidateCompanyCaches.mock.calls
        .map(([companyId]) => companyId)
        .sort((left, right) => left - right)
    ).toEqual([407, 409])
    expect(
      mocks.invalidatePatchContentCache.mock.calls
        .map(([uniqueId]) => uniqueId)
        .sort()
    ).toEqual(['patch-10', 'patch-30'])

    const statements = database.tx.$executeRawUnsafe.mock.calls.map(([sql]) =>
      String(sql)
    )
    expect(
      statements.findIndex((sql) => sql.includes("'company-merge-queue'"))
    ).toBeLessThan(statements.findIndex((sql) => sql.includes('LOCK TABLE')))
    expect(
      database.tx.$queryRawUnsafe.mock.calls.map((call) => call[1])
    ).toEqual(['407,408', '407,408,409'])
  })

  it('still merges the checked pair when an unchecked company is already gone', async () => {
    const state = subsetState()
    state.companies = state.companies.filter((row) => row.id !== 408)
    const database = createFakeCompanyDatabase({
      state,
      ownerIds: { 407: 11, 409: 22 }
    })
    wire(database)

    await expect(
      applyCompanyMergeSuggestion(selectedInput, 42)
    ).resolves.toEqual({
      id: 7,
      targetCompanyId: 407,
      databaseStatus: 'applied'
    })
    expect(database.readRows().some((row) => row.id === 409)).toBe(false)
    expect(database.readRows().some((row) => row.id === 407)).toBe(true)
  })

  it('rejects an introduction source that was not checked', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)

    await expect(
      applyCompanyMergeSuggestion(
        { ...selectedInput, introductionFromCompanyId: 408 },
        42
      )
    ).resolves.toBe('介绍的来源必须是勾选的会社之一')
    expect(database.$transaction).not.toHaveBeenCalled()
    expect(database.suggestions.get(7)?.status).toBe('pending')
  })

  it('does not default a missing selection to the whole cluster', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)
    const { selectedCompanyIds, ...withoutSelection } = selectedInput
    void selectedCompanyIds

    await expect(
      applyCompanyMergeSuggestion(withoutSelection as typeof selectedInput, 42)
    ).resolves.toBe('至少选择两家会社')
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('turns an existing pending pair into the exclusion instead of inserting another row', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)
    database.suggestions.set(50, {
      id: 50,
      status: 'pending',
      target_company_id: 407,
      source_company_ids: [408],
      member_key: '407,408',
      candidate_key: 'suffix-unique-hit|407,408',
      names: ['keep', 'me'],
      resolved_at: null,
      resolved_by_user_id: null
    })
    database.pendingKeys.set('407,408', 50)

    await applyCompanyMergeSuggestion(selectedInput, 42)

    expect(rowsWithKey(database, '407,408')).toEqual([
      expect.objectContaining({
        id: 50,
        status: 'dismissed',
        resolution_source: 'partial-merge-exclusion',
        candidate_key: null,
        names: ['keep', 'me']
      })
    ])
    expect(database.pendingKeys.has('407,408')).toBe(false)
  })

  it('does not overwrite an operator dismiss when excluding the same pair', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)
    const resolvedAt = new Date('2026-01-01T00:00:00.000Z')
    database.suggestions.set(51, {
      id: 51,
      status: 'dismissed',
      target_company_id: 407,
      source_company_ids: [408],
      member_key: '407,408',
      names: ['Kotama Yuri', 'WINGALD'],
      resolution_source: 'operator-dismiss',
      resolved_at: resolvedAt,
      resolved_by_user_id: 5,
      evidence: { hits: [] }
    })

    await applyCompanyMergeSuggestion(selectedInput, 42)

    const kept = database.suggestions.get(51)
    expect(rowsWithKey(database, '407,408')).toHaveLength(1)
    expect(kept?.resolved_by_user_id).toBe(5)
    expect(kept?.resolved_at).toBe(resolvedAt)
    expect(kept?.resolution_source).toBe('operator-dismiss')
    expect(kept?.evidence).toMatchObject({
      hits: [],
      laterPartialMergeExclusions: [
        expect.objectContaining({ parentSuggestionId: 7, memberKey: '407,408' })
      ]
    })
  })

  it('updates the parent pointer on an existing automatic exclusion without moving its time', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)
    const resolvedAt = new Date('2026-02-02T00:00:00.000Z')
    database.suggestions.set(52, {
      id: 52,
      status: 'dismissed',
      target_company_id: 407,
      source_company_ids: [408],
      member_key: '407,408',
      candidate_key: null,
      resolution_source: 'partial-merge-exclusion',
      resolved_at: resolvedAt,
      resolved_by_user_id: 8,
      evidence: {
        hits: [],
        resolutionSource: 'partial-merge-exclusion',
        parentSuggestionId: 3
      }
    })

    await applyCompanyMergeSuggestion(selectedInput, 42)

    const kept = database.suggestions.get(52)
    expect(rowsWithKey(database, '407,408')).toHaveLength(1)
    expect(kept?.resolved_at).toBe(resolvedAt)
    expect(kept?.resolved_by_user_id).toBe(8)
    expect(kept?.evidence).toMatchObject({ parentSuggestionId: 7 })
  })

  it('removes another pending suggestion whose other company was deleted', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)
    database.suggestions.set(80, {
      id: 80,
      status: 'pending',
      kind: 'suffix-unique-hit',
      target_company_id: 408,
      source_company_ids: [409],
      names: ['WINGALD', '小珠ゆり'],
      member_key: '408,409',
      candidate_key: 'suffix-unique-hit|408,409',
      folded_key: 'wingald',
      evidence: { hits: [] },
      resolved_at: null,
      resolved_by_user_id: null
    })
    database.pendingKeys.set('408,409', 80)

    await applyCompanyMergeSuggestion(selectedInput, 42)

    expect(database.suggestions.has(80)).toBe(false)
    expect(database.pendingKeys.has('408,409')).toBe(false)
    expect(database.suggestions.get(7)?.status).toBe('accepted')
  })

  it('does not insert an exclusion when that pair was already accepted', async () => {
    const database = createFakeCompanyDatabase({
      state: subsetState(),
      ownerIds: { 407: 11, 408: 99, 409: 22 }
    })
    wire(database)
    database.suggestions.set(53, {
      id: 53,
      status: 'accepted',
      target_company_id: 407,
      source_company_ids: [408],
      member_key: '407,408',
      resolution_source: 'operator-merge',
      resolved_at: new Date('2026-03-03T00:00:00.000Z'),
      resolved_by_user_id: 8,
      names: ['Kotama Yuri', 'WINGALD']
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await applyCompanyMergeSuggestion(selectedInput, 42)

    expect(rowsWithKey(database, '407,408')).toEqual([
      expect.objectContaining({ id: 53, status: 'accepted' })
    ])
    expect(errorSpy).toHaveBeenCalledWith(
      '[company-merges] skip auto-exclude member_key=407,408 already accepted'
    )
    errorSpy.mockRestore()
  })
})
