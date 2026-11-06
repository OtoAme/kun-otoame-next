import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficialMirrorError } from '~/lib/officialMirror/errors'

const harness = vi.hoisted(() => {
  const sqlOf = (query: unknown) => {
    if (!query || typeof query !== 'object') return String(query)
    const record = query as { sql?: unknown; strings?: unknown }
    if (typeof record.sql === 'string') return record.sql
    if (Array.isArray(record.strings)) return record.strings.join(' ')
    return ''
  }
  const valuesOf = (query: unknown) => {
    if (!query || typeof query !== 'object') return [] as unknown[]
    const values = (query as { values?: unknown }).values
    return Array.isArray(values) ? values : []
  }
  const queries: { sql: string; values: unknown[] }[] = []
  const logs: { type: string; content: string }[] = []
  let respond = (_sql: string, _values: unknown[]): unknown => []
  const tx = {
    $queryRaw: async (query: unknown) => {
      const sql = sqlOf(query)
      const values = valuesOf(query)
      queries.push({ sql, values })
      return respond(sql, values)
    },
    $executeRaw: async (query: unknown) => {
      const sql = sqlOf(query)
      const values = valuesOf(query)
      queries.push({ sql, values })
      return respond(sql, values)
    },
    user: { findUnique: async () => ({ name: '站方' }) },
    admin_log: {
      create: async ({ data }: { data: { type: string; content: string } }) => {
        logs.push(data)
        return data
      }
    },
    patch_resource: {
      delete: async () => ({}),
      update: async () => ({})
    },
    patch_resource_link: { update: async () => ({}) },
    patch_resource_link_history: {
      create: async () => ({}),
      updateMany: async () => ({ count: 0 })
    },
    patch_resource_access: { updateMany: async () => ({ count: 0 }) },
    patch_resource_access_grant: {
      update: async () => ({}),
      delete: async () => ({})
    },
    patch_resource_link_check: { updateMany: async () => ({ count: 0 }) },
    patch_resource_link_maintenance: { updateMany: async () => ({ count: 0 }) },
    help_post: { updateMany: async () => ({ count: 0 }) },
    ops_case: { updateMany: async () => ({ count: 0 }) },
    user_patch_resource_like_relation: { count: async () => 0 }
  }
  return {
    queries,
    logs,
    tx,
    reset: () => {
      queries.length = 0
      logs.length = 0
      respond = () => []
    },
    setResponder: (fn: typeof respond) => {
      respond = fn
    }
  }
})

vi.mock('~/prisma/index', () => ({ prisma: harness.tx }))
vi.mock('~/lib/officialMirror/cache', () => ({
  refreshAfterCommit: async () => true,
  refreshOfficialMirrorPresentation: async () => undefined
}))
vi.mock('~/app/api/patch/resource/mutation', () => ({
  runResourceMutation: (work: (tx: typeof harness.tx) => Promise<unknown>) =>
    work(harness.tx),
  ResourceMutationError: class ResourceMutationError extends Error {}
}))
vi.mock('~/app/api/patch/resource/maintenance/service', () => ({
  lockLinkMaintenance: async () => undefined
}))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  updatePatchAttributes: async () => 'abcd1234'
}))
vi.mock('~/app/api/moemoepoint/service', () => ({
  MoemoepointInsufficientError: class MoemoepointInsufficientError extends Error {},
  spendMoemoepoint: async () => ({ balance: 1 }),
  earnMoemoepoint: async () => ({ balance: 1 }),
  getCurrentBalance: async () => 1
}))
vi.mock('~/app/api/utils/message', () => ({
  createMessage: async () => undefined
}))

import { createHelpPost } from '~/app/api/help/service'
import {
  backupBasis,
  buildCandidates,
  mergeBasis,
  mergeNotes,
  movedLinkSorts,
  planGrants,
  queueTab,
  queueWaitSince,
  type MergeRecordFact,
  type MirrorCard,
  type MirrorLink,
  type OpenCaseFact
} from '~/lib/officialMirror/decide'
import {
  dismissRebackup,
  ignoreBackup
} from '~/lib/officialMirror/backupService'
import {
  dismissMergeCard,
  dismissResourceMerge,
  getMergeOptions,
  listResourceMerges,
  mergeStaffBatch,
  mergeStaffIntoUser,
  parseMergeDetail,
  previewResourceMerge
} from '~/lib/officialMirror/mergeService'
import { rowCard, rowLink } from '~/lib/officialMirror/rows'
import {
  lookupMergedSurvivorId,
  resolveMergedResource
} from '~/lib/officialMirror/resolve'
import { sqlTimestamp, timestampWithoutZone } from '~/lib/officialMirror/time'
import {
  mergeBatchSchema,
  mergeExecuteSchema,
  mergeListSchema
} from '~/validations/officialMirror'

const at = (value: string) => new Date(value)

const link = (overrides: Partial<MirrorLink> = {}): MirrorLink => ({
  id: 1,
  resourceId: 1,
  storage: 'user',
  content: 'https://example.test/a',
  size: '1',
  code: '',
  password: '',
  fileHash: '',
  version: 1,
  sortOrder: 0,
  attachedAt: at('2026-01-01T00:00:00.000Z'),
  contentChangedAt: null,
  ...overrides
})

const card = (overrides: Partial<MirrorCard> = {}): MirrorCard => ({
  id: 1,
  patchId: 10,
  patchUniqueId: 'abcd1234',
  patchName: '游戏',
  patchStatus: 0,
  section: 'galgame',
  name: '卡片',
  note: '',
  type: ['游戏'],
  language: ['日语'],
  platform: ['Windows'],
  status: 0,
  download: 0,
  userId: 2,
  publisherName: '用户',
  role: 1,
  publisherLeftAt: null,
  created: at('2026-01-01T00:00:00.000Z'),
  updated: at('2026-01-02T00:00:00.000Z'),
  links: [link()],
  ...overrides
})

const record = (overrides: Partial<MergeRecordFact> = {}): MergeRecordFact => ({
  userResourceId: 1,
  staffResourceId: 2,
  status: 'dismissed',
  patchId: 10,
  section: 'galgame',
  detail: null,
  handledAt: null,
  handledByUserId: null,
  ...overrides
})

const openCase = (id: number): OpenCaseFact => ({
  id,
  targetType: 'resource',
  targetId: 2,
  status: 'open',
  revision: 1
})

const basis = 'a'.repeat(64)
const confirmed = {
  basis,
  contentConfirmed: true as const
}

describe('official mirror queue and merge decisions', () => {
  it('keeps ignored ahead of a later external change and does not use ignore time as the wait', () => {
    const changed = at('2026-04-01T00:00:00.000Z')
    const ignored = card({
      links: [
        link({
          id: 1,
          storage: 'touchgal',
          attachedAt: at('2026-01-01T00:00:00.000Z')
        }),
        link({
          id: 2,
          storage: 'user',
          attachedAt: at('2026-01-15T00:00:00.000Z'),
          contentChangedAt: changed
        })
      ]
    })
    const withIgnore = {
      ...ignored,
      ignoredAt: at('2026-02-01T00:00:00.000Z'),
      rebackupDismissedAt: null
    }
    const pending = { ...withIgnore, ignoredAt: null }
    expect(queueTab(withIgnore)).toBe('ignored')
    expect(queueWaitSince(withIgnore, 'ignored')).toBeNull()
    expect(queueTab(pending)).toBe('rebackup')
    expect(queueWaitSince(pending, 'rebackup')?.toISOString()).toBe(
      changed.toISOString()
    )
  })

  it('classifies unbacked, backed, handover, staff and non-user storage outside the three tabs', () => {
    const external = link({
      storage: 'user',
      attachedAt: at('2026-01-03T00:00:00.000Z')
    })
    const backup = link({
      id: 2,
      storage: 'touchgal',
      attachedAt: at('2026-01-04T00:00:00.000Z')
    })
    const plain = { ignoredAt: null, rebackupDismissedAt: null }
    expect(queueTab({ ...card({ links: [external] }), ...plain })).toBe(
      'unbacked'
    )
    expect(
      queueWaitSince(
        { ...card({ links: [external] }), ...plain },
        'unbacked'
      )?.toISOString()
    ).toBe('2026-01-03T00:00:00.000Z')
    expect(
      queueTab({ ...card({ links: [external, backup] }), ...plain })
    ).toBeNull()
    expect(
      queueTab({ ...card({ links: [link({ storage: 's3' })] }), ...plain })
    ).toBeNull()
    expect(
      queueTab({
        ...card({ publisherLeftAt: at('2026-01-05T00:00:00.000Z') }),
        ...plain
      })
    ).toBeNull()
    expect(
      queueTab({ ...card({ role: 3, links: [external] }), ...plain })
    ).toBeNull()
    expect(
      queueTab({ ...card({ status: 1, links: [external] }), ...plain })
    ).toBeNull()
  })

  it('does not treat a reviewed external change as a new rebackup, and does not move the watermark idea backward', () => {
    const backupAt = at('2026-01-01T00:00:00.000Z')
    const reviewed = at('2026-02-01T00:00:00.000Z')
    const links = [
      link({ id: 1, storage: 'touchgal', attachedAt: backupAt }),
      link({
        id: 2,
        storage: 'user',
        attachedAt: backupAt,
        contentChangedAt: reviewed
      })
    ]
    const covered = {
      ...card({ links }),
      ignoredAt: null,
      rebackupDismissedAt: reviewed
    }
    expect(queueTab(covered)).toBeNull()
    expect(
      queueTab({
        ...covered,
        rebackupDismissedAt: at('2026-01-15T00:00:00.000Z')
      })
    ).toBe('rebackup')
    expect(queueWaitSince(covered, 'rebackup')).toBeNull()
  })

  it('allows a 10007-character note and blocks 10008 without truncating', () => {
    const exact = '站方备份说明：' + '字'.repeat(10000)
    expect(exact).toHaveLength(10007)
    expect(mergeNotes('', '字'.repeat(10000))).toEqual({
      note: exact,
      appended: true,
      blocked: false
    })
    expect(mergeNotes('', '字'.repeat(10001)).blocked).toBe(true)
    expect(mergeNotes('已有站方备份说明', '站方备份说明')).toMatchObject({
      appended: false
    })
    expect(mergeNotes('', '   ').appended).toBe(false)
    expect(mergeNotes('正文', '补充').note).toBe('正文\n\n站方备份说明：补充')
  })

  it('puts link secrets and open cases in the merge digest only', () => {
    const user = card({
      id: 1,
      links: [link({ password: 'secret', code: 'code', fileHash: 'hash' })]
    })
    const staff = card({
      id: 2,
      role: 3,
      userId: 9,
      links: [
        link({
          id: 3,
          resourceId: 2,
          storage: 'touchgal',
          password: 'staff-secret'
        })
      ]
    })
    const first = mergeBasis({
      user,
      staff,
      openCases: [openCase(2), openCase(1)]
    })
    const reordered = mergeBasis({
      user,
      staff,
      openCases: [openCase(1), openCase(2)]
    })
    const changedPassword = mergeBasis({
      user,
      staff: {
        ...staff,
        links: [{ ...staff.links[0], password: 'other' }]
      },
      openCases: [openCase(1), openCase(2)]
    })
    expect(first).toBe(reordered)
    expect(changedPassword).not.toBe(first)
    expect(backupBasis(staff)).toBe(
      backupBasis({
        ...staff,
        links: [
          { ...staff.links[0], password: 'other', code: 'x', fileHash: 'y' }
        ]
      })
    )
    expect(backupBasis(user)).not.toContain('secret')
    expect(mergeBasis({ user, staff, openCases: [] })).toBe(
      mergeBasis({ user: { ...user, download: 99 }, staff, openCases: [] })
    )
  })

  it('promotes the remaining live pair after one pair is dismissed and refuses a second survivor', () => {
    const user = card({ id: 1, created: at('2026-01-01T00:00:00.000Z') })
    const olderStaff = card({
      id: 2,
      role: 3,
      userId: 8,
      created: at('2026-02-01T00:00:00.000Z'),
      links: [link({ id: 2, resourceId: 2, storage: 'touchgal' })]
    })
    const newerStaff = card({
      ...olderStaff,
      id: 3,
      links: [link({ id: 3, resourceId: 3, storage: 'touchgal' })]
    })
    const both = buildCandidates([user, olderStaff, newerStaff], [])
    expect(both.map((pair) => pair.pairClass)).toEqual(['manual', 'manual'])
    const afterDismiss = buildCandidates(
      [user, olderStaff, newerStaff],
      [record({ staffResourceId: 2 })]
    )
    expect(afterDismiss).toEqual([
      expect.objectContaining({
        staff: expect.objectContaining({ id: 3 }),
        pairClass: 'high'
      })
    ])
    expect(
      buildCandidates(
        [user, olderStaff],
        [record({ status: 'merged', staffResourceId: 2 })]
      )
    ).toEqual([])
    expect(
      buildCandidates([user, card({ id: 4, role: 3, section: 'patch' })], [])
    ).toEqual([])
    expect(buildCandidates([card({ role: 3 }), olderStaff], [])).toEqual([])
  })

  it('keeps the later existing grant and does not invent a new expiry', () => {
    const userExpires = at('2026-05-01T00:00:00.000Z')
    const staffExpires = at('2026-06-01T00:00:00.000Z')
    const equal = planGrants(1, 2, [
      { actorKey: 'actor', resourceId: 1, expires: userExpires },
      { actorKey: 'actor', resourceId: 2, expires: userExpires }
    ])
    expect(equal).toEqual([
      { actorKey: 'actor', kind: 'keep-max', expires: userExpires }
    ])
    expect(equal[0].expires).toBe(userExpires)
    expect(
      planGrants(1, 2, [
        { actorKey: 'actor', resourceId: 1, expires: userExpires },
        { actorKey: 'actor', resourceId: 2, expires: staffExpires }
      ])
    ).toEqual([{ actorKey: 'actor', kind: 'keep-max', expires: staffExpires }])
    expect(
      planGrants(1, 2, [
        { actorKey: 'actor', resourceId: 2, expires: staffExpires }
      ])
    ).toEqual([{ actorKey: 'actor', kind: 'move', expires: staffExpires }])
  })

  it('formats decision timestamps without a zone and casts them to timestamp(3)', () => {
    const value = at('2026-11-04T01:02:03.004Z')
    expect(timestampWithoutZone(value)).toBe('2026-11-04 01:02:03.004')
    const fragment = sqlTimestamp(value)
    expect(fragment.sql).toContain('::timestamp(3) without time zone')
    expect(fragment.sql.toLowerCase()).not.toContain('timestamptz')
    expect(fragment.values).toEqual(['2026-11-04 01:02:03.004'])
  })
})

describe('official mirror contract validation', () => {
  it('requires a hex basis string and a per-pair confirmation', () => {
    const pair = {
      userResourceId: 1,
      staffResourceId: 2,
      basis,
      contentConfirmed: true
    }
    expect(mergeExecuteSchema.safeParse(pair).success).toBe(true)
    expect(
      mergeExecuteSchema.safeParse({ ...pair, contentConfirmed: false }).success
    ).toBe(false)
    expect(
      mergeExecuteSchema.safeParse({ ...pair, basis: [basis] }).success
    ).toBe(false)
    expect(
      mergeBatchSchema.safeParse({
        pairs: Array.from({ length: 51 }, () => pair)
      }).success
    ).toBe(false)
  })
})

describe('official mirror backup and merge services', () => {
  const cardRow = {
    id: 5,
    name: '外部卡',
    section: 'galgame',
    patch_id: 10,
    download: 2,
    user_id: 3,
    status: 0,
    note: '',
    type: ['游戏'],
    language: ['日语'],
    platform: ['Windows'],
    publisher_left_at: null,
    created: at('2026-01-01T00:00:00.000Z'),
    updated: at('2026-01-02T00:00:00.000Z'),
    publisher_name: '用户',
    role: 1,
    patch_name: '游戏',
    patch_unique_id: 'abcd1234',
    patch_status: 0
  }

  beforeEach(() => {
    harness.reset()
  })

  it('writes ignore time as timestamp(3) without time zone', async () => {
    harness.setResponder((sql) => {
      if (sql.includes('SELECT id FROM patch_resource WHERE'))
        return [{ id: 5 }]
      if (sql.includes('publisher_name')) return [cardRow]
      if (sql.includes('FROM patch_resource_link')) {
        return [
          {
            id: 8,
            resource_id: 5,
            storage: 'user',
            content: 'https://example.test/a',
            size: '3',
            version: 1,
            sort_order: 0,
            attached_at: at('2026-02-01T00:00:00.000Z'),
            content_changed_at: null
          }
        ]
      }
      return []
    })
    const result = await ignoreBackup({ resourceId: 5, reason: '暂不备份' }, 7)
    const insert = harness.queries.find((query) =>
      query.sql.includes('INSERT INTO patch_resource_backup_state')
    )
    expect(typeof result).not.toBe('string')
    expect(insert?.sql).toContain('::timestamp(3) without time zone')
    expect(insert?.sql.toLowerCase()).not.toContain('timestamptz')
    expect(
      insert?.values.some(
        (value) => typeof value === 'string' && value.includes('-')
      )
    ).toBe(true)
    expect(harness.logs).toHaveLength(1)
  })

  it('does not write another dismiss log when the same reviewed change is already covered', async () => {
    const touchgalAt = at('2026-03-01T00:00:00.000Z')
    const userAt = at('2026-03-04T00:00:00.000Z')
    let covered = false
    const links = [
      link({
        id: 1,
        resourceId: 5,
        storage: 'touchgal',
        content: 'tg',
        attachedAt: touchgalAt
      }),
      link({
        id: 2,
        resourceId: 5,
        storage: 'user',
        content: 'ext',
        version: 2,
        sortOrder: 1,
        attachedAt: touchgalAt,
        contentChangedAt: userAt
      })
    ]
    const digest = backupBasis({
      id: 5,
      status: 0,
      role: 1,
      publisherLeftAt: null,
      links
    })
    harness.setResponder((sql) => {
      if (sql.includes('SELECT id FROM patch_resource WHERE'))
        return [{ id: 5 }]
      if (sql.includes('publisher_name')) return [cardRow]
      if (sql.includes('FROM patch_resource_link')) {
        return [
          {
            id: 1,
            resource_id: 5,
            storage: 'touchgal',
            content: 'tg',
            size: '1',
            version: 1,
            sort_order: 0,
            attached_at: touchgalAt,
            content_changed_at: null
          },
          {
            id: 2,
            resource_id: 5,
            storage: 'user',
            content: 'ext',
            size: '1',
            version: 2,
            sort_order: 1,
            attached_at: touchgalAt,
            content_changed_at: userAt
          }
        ]
      }
      if (sql.includes('FROM patch_resource_backup_state')) {
        return covered
          ? [{ resource_id: 5, rebackup_dismissed_at: userAt }]
          : []
      }
      if (sql.includes('INSERT INTO patch_resource_backup_state')) {
        covered = true
        return 1
      }
      return []
    })
    const first = await dismissRebackup({ resourceId: 5, basis: digest }, 7)
    const second = await dismissRebackup({ resourceId: 5, basis: digest }, 7)
    expect(first).toMatchObject({ changed: true })
    expect(second).toMatchObject({ changed: false })
    expect(harness.logs).toHaveLength(1)
    expect(
      harness.queries.filter((query) =>
        query.sql.includes('INSERT INTO patch_resource_backup_state')
      )
    ).toHaveLength(1)
    const stale = await dismissRebackup({ resourceId: 5, basis }, 7)
    expect(stale).toBe('预览已变化，请重新核对')
  })

  it('replays an exact merged pair before treating the missing staff card as gone', async () => {
    harness.setResponder((sql) => {
      if (sql.includes('om:lock-merge-record')) {
        return [
          {
            user_resource_id: 1,
            staff_resource_id: 2,
            patch_id: 10,
            section: 'galgame',
            status: 'merged',
            detail: {
              movedLinkIds: [4],
              noteAppended: false,
              contentConfirmed: true,
              basis,
              sourceAuthorId: 8,
              likeCount: 3,
              userResourceId: 1,
              staffResourceId: 2
            }
          }
        ]
      }
      if (sql.includes('unique_id')) {
        return [
          { id: 1, section: 'galgame', patch_id: 10, unique_id: 'abcd1234' }
        ]
      }
      return []
    })
    const result = await mergeStaffIntoUser(
      { userResourceId: 1, staffResourceId: 2, ...confirmed },
      7
    )
    expect(result).toMatchObject({
      alreadyMerged: true,
      userResourceId: 1,
      staffResourceId: 2,
      patchUniqueId: 'abcd1234'
    })
    expect(
      harness.queries.some((query) => query.sql.includes('om:lock-links'))
    ).toBe(false)
    expect(
      harness.queries.some((query) =>
        query.sql.includes('INSERT INTO patch_resource_merge_record')
      )
    ).toBe(false)

    harness.reset()
    harness.setResponder(() => [])
    const missing = await mergeStaffIntoUser(
      { userResourceId: 1, staffResourceId: 2, ...confirmed },
      7
    )
    expect(missing).toBe('未找到对应的资源')
  })

  it('continues after a business skip and stops only the unstarted tail after an infrastructure error', async () => {
    let started = 0
    harness.setResponder((sql) => {
      if (!sql.includes('om:lock-resources')) return []
      started += 1
      if (started === 1) throw new OfficialMirrorError('站方卡片未公开')
      throw new Error('connection reset')
    })
    const result = await mergeStaffBatch(
      {
        pairs: [
          { userResourceId: 1, staffResourceId: 2, ...confirmed },
          { userResourceId: 3, staffResourceId: 4, ...confirmed },
          { userResourceId: 5, staffResourceId: 6, ...confirmed }
        ]
      },
      7
    )
    expect(result.outcomes.map((item) => item.status)).toEqual([
      'skipped',
      'failed'
    ])
    expect(result.remaining).toEqual([
      { userResourceId: 5, staffResourceId: 6 }
    ])
    if (result.outcomes[0].status === 'skipped') {
      expect(result.outcomes[0].reason).toBe('站方卡片未公开')
    }
    if (result.outcomes[1].status === 'failed') {
      expect(result.outcomes[1].reason).toBe('合并事务中断')
    }
  })
})

describe('official mirror list, dismiss, and batch regressions', () => {
  const sqlCard = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    name: '卡片',
    section: 'galgame',
    patch_id: 10,
    download: 1,
    user_id: 2,
    status: 0,
    note: '',
    type: ['游戏'],
    language: ['日语'],
    platform: ['Windows'],
    publisher_left_at: null,
    created: at('2026-01-01T00:00:00.000Z'),
    updated: at('2026-01-02T00:00:00.000Z'),
    publisher_name: '发布者',
    role: 1,
    patch_name: '原游戏',
    patch_unique_id: 'abcd1234',
    patch_status: 0,
    ...overrides
  })
  const sqlLink = (overrides: Record<string, unknown> = {}) => ({
    id: 11,
    resource_id: 1,
    storage: 'user',
    content: 'https://example.test/a',
    size: '1',
    code: '',
    password: '',
    hash: '',
    version: 1,
    sort_order: 0,
    attached_at: at('2026-01-01T00:00:00.000Z'),
    content_changed_at: null,
    ...overrides
  })
  const listInput = {
    tab: 'pending' as const,
    search: '',
    page: 1,
    limit: 20
  }

  beforeEach(() => {
    harness.reset()
  })

  it('keeps the full candidate set when search matches only one side', async () => {
    harness.setResponder((sql) => {
      if (sql.includes('om:live-cards')) {
        return [
          sqlCard({ id: 1, name: '可见用户', user_id: 2, role: 1 }),
          sqlCard({
            id: 2,
            name: '甲',
            user_id: 8,
            role: 3,
            publisher_name: '站方甲',
            created: at('2026-03-01T00:00:00.000Z')
          }),
          sqlCard({
            id: 3,
            name: '乙',
            user_id: 9,
            role: 3,
            publisher_name: '站方乙',
            created: at('2026-03-02T00:00:00.000Z')
          })
        ]
      }
      if (sql.includes('FROM patch_resource_link')) {
        return [
          sqlLink({ id: 11, resource_id: 1, storage: 'user' }),
          sqlLink({ id: 12, resource_id: 2, storage: 'touchgal' }),
          sqlLink({ id: 13, resource_id: 3, storage: 'touchgal' })
        ]
      }
      return []
    })
    const byUser = await listResourceMerges({ ...listInput, search: '可见' })
    const byStaff = await listResourceMerges({ ...listInput, search: '甲' })
    expect(byUser.items).toHaveLength(1)
    expect(byUser.items[0]?.candidateCount).toBe(2)
    expect(byUser.items[0]?.pairClass).toBe('manual')
    expect(byStaff.items[0]?.candidateCount).toBe(2)
    expect(byStaff.items[0]?.pairClass).toBe('manual')
    expect(
      byStaff.items[0]?.candidates.map((item) => item.staffResourceId).sort()
    ).toEqual([2, 3])
  })

  it('keeps a merged row after the only staff card is gone, the author is promoted, and the path changed', async () => {
    harness.setResponder((sql) => {
      if (sql.includes('om:merge-history')) {
        return [
          {
            user_resource_id: 5,
            staff_resource_id: 9,
            patch_id: 10,
            section: 'galgame',
            status: 'merged',
            detail: {}
          }
        ]
      }
      if (sql.includes('om:record-cards')) {
        return [
          sqlCard({
            id: 5,
            name: '留下的卡',
            role: 4,
            user_id: 2,
            patch_id: 77,
            section: 'patch',
            patch_name: '新路径',
            patch_unique_id: 'zzzz9999'
          })
        ]
      }
      return []
    })
    const listed = await listResourceMerges({
      ...listInput,
      tab: 'merged',
      search: ''
    })
    expect(listed.counts.merged).toBe(1)
    expect(listed.items[0]?.userResource).toMatchObject({
      id: 5,
      patchId: 77,
      section: 'patch',
      patchName: '新路径'
    })
    expect(listed.items[0]?.candidates[0]).toMatchObject({
      staffResourceId: 9,
      staffName: '已合并的站方卡片 9'
    })
  })

  it('blocks a pending pair when only a staff link case is open', async () => {
    harness.setResponder((sql) => {
      if (sql.includes('om:live-cards')) {
        return [
          sqlCard({ id: 1, role: 1 }),
          sqlCard({
            id: 2,
            role: 3,
            user_id: 8,
            created: at('2026-03-01T00:00:00.000Z')
          })
        ]
      }
      if (sql.includes('om:open-staff')) return [{ resource_id: 2 }]
      if (sql.includes('FROM patch_resource_link')) {
        return [
          sqlLink({ resource_id: 1, storage: 'user' }),
          sqlLink({ id: 12, resource_id: 2, storage: 'touchgal' })
        ]
      }
      return []
    })
    const listed = await listResourceMerges(listInput)
    expect(listed.items[0]?.blocks.map((block) => block.code)).toContain(
      'staff_case_open'
    )
  })

  it('rechecks the current candidate inside dismiss and stays idempotent', async () => {
    const baseCard = sqlCard({ id: 1, role: 1 })
    const staffCard = sqlCard({ id: 2, role: 3, user_id: 8 })
    harness.setResponder((sql) => {
      if (sql.includes('publisher_name'))
        return [
          { ...baseCard, publisher_left_at: at('2026-04-01T00:00:00.000Z') },
          staffCard
        ]
      if (sql.includes('FROM patch_resource_link')) {
        return [sqlLink({ resource_id: 1, storage: 'user' })]
      }
      return []
    })
    expect(
      await dismissResourceMerge({ userResourceId: 1, staffResourceId: 2 }, 7)
    ).toBe('用户卡片已交接')

    harness.setResponder((sql) => {
      if (sql.includes('publisher_name'))
        return [{ ...baseCard, status: 1 }, staffCard]
      if (sql.includes('FROM patch_resource_link')) {
        return [sqlLink({ resource_id: 1, storage: 'user' })]
      }
      return []
    })
    expect(
      await dismissResourceMerge({ userResourceId: 1, staffResourceId: 2 }, 7)
    ).toBe('用户卡片未公开')

    harness.setResponder((sql) => {
      if (sql.includes('om:lock-merge-record')) return []
      if (
        sql.includes('patch_resource_merge_record') &&
        !sql.includes('INSERT')
      ) {
        return [
          {
            user_resource_id: 2,
            staff_resource_id: 99,
            patch_id: 10,
            section: 'galgame',
            status: 'merged',
            detail: {}
          }
        ]
      }
      if (sql.includes('publisher_name')) return [baseCard, staffCard]
      if (sql.includes('FROM patch_resource_link')) {
        return [sqlLink({ resource_id: 1, storage: 'user' })]
      }
      return []
    })
    expect(
      await dismissResourceMerge({ userResourceId: 1, staffResourceId: 2 }, 7)
    ).toBe('不能再次合并已留下的卡片')

    harness.reset()
    harness.setResponder((sql) => {
      if (
        sql.includes('om:lock-merge-record') ||
        sql.includes('patch_resource_merge_record')
      ) {
        return [
          {
            user_resource_id: 1,
            staff_resource_id: 2,
            patch_id: 10,
            section: 'galgame',
            status: 'dismissed',
            detail: {}
          }
        ]
      }
      if (sql.includes('publisher_name')) return [baseCard, staffCard]
      return []
    })
    expect(
      await dismissResourceMerge({ userResourceId: 1, staffResourceId: 2 }, 7)
    ).toEqual({
      changed: false
    })
    expect(harness.logs).toHaveLength(0)
    expect(
      harness.queries.some((query) =>
        query.sql.includes('INSERT INTO patch_resource_merge_record')
      )
    ).toBe(false)
  })

  it('still treats the pair as high confidence when another game card already survived', async () => {
    const userRow = sqlCard({ id: 1, role: 1, user_id: 2, name: '用户卡' })
    const staffRow = sqlCard({
      id: 2,
      role: 3,
      user_id: 8,
      name: '站方卡',
      publisher_name: '站方',
      created: at('2026-03-01T00:00:00.000Z')
    })
    const survivorRow = sqlCard({
      id: 4,
      role: 3,
      user_id: 9,
      name: '已留下',
      publisher_name: '旧站方',
      created: at('2026-02-01T00:00:00.000Z')
    })
    const userLink = sqlLink({ id: 11, resource_id: 1, storage: 'user' })
    const staffLink = sqlLink({
      id: 12,
      resource_id: 2,
      storage: 'touchgal',
      content: 'https://example.test/tg'
    })
    const digest = mergeBasis({
      user: card({
        id: 1,
        role: 1,
        userId: 2,
        name: '用户卡',
        publisherName: '发布者',
        patchName: '原游戏',
        download: 1,
        links: [link({ id: 11, resourceId: 1, storage: 'user' })]
      }),
      staff: card({
        id: 2,
        role: 3,
        userId: 8,
        name: '站方卡',
        publisherName: '站方',
        patchName: '原游戏',
        download: 1,
        created: at('2026-03-01T00:00:00.000Z'),
        links: [
          link({
            id: 12,
            resourceId: 2,
            storage: 'touchgal',
            content: 'https://example.test/tg'
          })
        ]
      }),
      openCases: []
    })
    harness.setResponder((sql, values) => {
      const ids = values.filter(
        (value): value is number => typeof value === 'number'
      )
      if (sql.includes('INSERT INTO patch_resource_merge_record'))
        return [{ id: 80 }]
      if (sql.includes('r.patch_id =')) return [userRow, staffRow, survivorRow]
      if (sql.includes('publisher_name')) return [userRow, staffRow]
      if (sql.includes('FROM patch_resource_link')) return [userLink, staffLink]
      if (sql.includes('user_resource_id IN') && ids.includes(4)) {
        return [
          {
            user_resource_id: 4,
            staff_resource_id: 7,
            patch_id: 10,
            section: 'galgame',
            status: 'merged',
            detail: {}
          }
        ]
      }
      return []
    })
    const result = await mergeStaffIntoUser(
      {
        userResourceId: 1,
        staffResourceId: 2,
        basis: digest,
        contentConfirmed: true
      },
      7,
      true
    )
    expect(result).toMatchObject({
      alreadyMerged: false,
      userResourceId: 1,
      staffResourceId: 2,
      movedLinkIds: [12]
    })
  })

  it('previews appended links in sort order rather than id order', async () => {
    const userRow = sqlCard({ id: 1, role: 1 })
    const staffRow = sqlCard({
      id: 2,
      role: 3,
      user_id: 8,
      created: at('2026-03-01T00:00:00.000Z')
    })
    harness.setResponder((sql) => {
      if (sql.includes('FROM ops_case')) return []
      if (sql.includes('r.patch_id =')) return [userRow, staffRow]
      if (sql.includes('publisher_name')) return [userRow, staffRow]
      if (sql.includes('FROM patch_resource_link')) {
        return [
          sqlLink({ id: 1, resource_id: 1, storage: 'user', sort_order: 4 }),
          sqlLink({
            id: 3,
            resource_id: 2,
            storage: 'touchgal',
            sort_order: 5
          }),
          sqlLink({
            id: 10,
            resource_id: 2,
            storage: 'touchgal',
            sort_order: 1,
            content: 'https://example.test/b'
          })
        ]
      }
      return []
    })
    const preview = await previewResourceMerge({
      userResourceId: 1,
      staffResourceId: 2
    })
    expect(preview).toMatchObject({
      linkSummary: {
        user: [{ id: 1, storage: 'user', size: '1' }],
        staff: [
          { id: 10, storage: 'touchgal', size: '1' },
          { id: 3, storage: 'touchgal', size: '1' }
        ]
      },
      survivorPreview: {
        links: [
          { id: 1, sortOrder: 4 },
          { id: 10, sortOrder: 5 },
          { id: 3, sortOrder: 6 }
        ]
      }
    })
    if (typeof preview === 'string') throw new Error(preview)
    for (const link of [
      ...preview.linkSummary.user,
      ...preview.linkSummary.staff
    ]) {
      expect(Object.keys(link).sort()).toEqual(['id', 'size', 'storage'])
    }
  })

  it('moves staff links by sort order rather than lock id order', () => {
    const user = card({ links: [link({ id: 1, sortOrder: 4 })] })
    const staff = card({
      id: 2,
      links: [
        link({ id: 3, resourceId: 2, sortOrder: 5 }),
        link({ id: 10, resourceId: 2, sortOrder: 1 })
      ]
    })
    expect(movedLinkSorts(user, staff).map((move) => move.id)).toEqual([10, 3])
    expect(movedLinkSorts(user, staff).map((move) => move.sortOrder)).toEqual([
      5, 6
    ])
  })

  it('reports one pair constraint failure and still merges the later pair', async () => {
    const secret =
      'postgres://official_mirror_d:super-secret@127.0.0.1/official_mirror_d_e2e'
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    harness.setResponder((sql, values) => {
      const ids = values.filter(
        (value): value is number => typeof value === 'number'
      )
      if (sql.includes('om:lock-merge-record') && ids.includes(1)) {
        return [
          {
            user_resource_id: 1,
            staff_resource_id: 2,
            patch_id: 10,
            section: 'galgame',
            status: 'merged',
            detail: {
              movedLinkIds: [],
              noteAppended: false,
              contentConfirmed: true,
              basis,
              sourceAuthorId: 8,
              likeCount: 0,
              userResourceId: 1,
              staffResourceId: 2
            }
          }
        ]
      }
      if (sql.includes('unique_id')) {
        return [
          { id: 1, section: 'galgame', patch_id: 10, unique_id: 'abcd1234' }
        ]
      }
      if (sql.includes('om:lock-resources') && ids.includes(3)) {
        throw Object.assign(new Error(`duplicate ${secret}`), { code: 'P2002' })
      }
      return []
    })
    const result = await mergeStaffBatch(
      {
        pairs: [
          { userResourceId: 1, staffResourceId: 2, ...confirmed },
          { userResourceId: 3, staffResourceId: 4, ...confirmed },
          { userResourceId: 5, staffResourceId: 6, ...confirmed }
        ]
      },
      7
    )
    spy.mockRestore()
    expect(result.outcomes.map((item) => item.status)).toEqual([
      'merged',
      'failed',
      'skipped'
    ])
    expect(result.remaining).toEqual([])
    if (result.outcomes[1]?.status === 'failed') {
      expect(result.outcomes[1].reason).toBe('合并约束冲突')
    }
    const logged = JSON.stringify(errors)
    expect(logged).toContain('3')
    expect(logged).toContain('4')
    expect(logged).not.toContain('super-secret')
    expect(logged).not.toContain('SELECT')
  })

  it('does not call the later pair after the database connection drops', async () => {
    let third = false
    harness.setResponder((sql, values) => {
      const ids = values.filter(
        (value): value is number => typeof value === 'number'
      )
      if (sql.includes('om:lock-resources') && ids.includes(1)) return []
      if (sql.includes('om:lock-resources') && ids.includes(3)) {
        throw new Error("Can't reach database server")
      }
      if (ids.includes(5)) third = true
      return []
    })
    const result = await mergeStaffBatch(
      {
        pairs: [
          { userResourceId: 1, staffResourceId: 2, ...confirmed },
          { userResourceId: 3, staffResourceId: 4, ...confirmed },
          { userResourceId: 5, staffResourceId: 6, ...confirmed }
        ]
      },
      7
    )
    expect(result.outcomes.map((item) => item.status)).toEqual([
      'skipped',
      'failed'
    ])
    expect(result.remaining).toEqual([
      { userResourceId: 5, staffResourceId: 6 }
    ])
    expect(third).toBe(false)
  })
})

describe('official mirror resolve and help retarget', () => {
  it('accepts only a positive survivor id and reuses the caller visibility policy', async () => {
    expect(
      await lookupMergedSurvivorId({ $queryRaw: async () => [{ id: 9 }] }, 2)
    ).toBeNull()
    expect(
      await lookupMergedSurvivorId(
        { $queryRaw: async () => [{ user_resource_id: '9' }] },
        2
      )
    ).toBeNull()
    const finds: Array<Record<string, unknown>> = []
    const hit = await resolveMergedResource(
      {
        $queryRaw: async () => [{ user_resource_id: 9 }],
        patch_resource: {
          findFirst: async (args) => {
            finds.push(args.where)
            return {
              id: 9,
              patch_id: 4,
              section: 'patch',
              patch: { unique_id: 'abcd1234' }
            }
          }
        }
      },
      2,
      { content_limit: 'sfw' }
    )
    expect(hit).toEqual({
      resourceId: 9,
      patchId: 4,
      patchUniqueId: 'abcd1234',
      section: 'patch'
    })
    expect(finds[0]).toMatchObject({
      id: 9,
      status: 0,
      patch: { status: 0, content_limit: 'sfw' }
    })
    const hidden = await resolveMergedResource(
      {
        $queryRaw: async () => [{ user_resource_id: 9 }],
        patch_resource: { findFirst: async () => null }
      },
      2,
      {}
    )
    expect(hidden).toBeNull()
  })

  it('retargets a help resource to the survivor and leaves a null resource untouched', async () => {
    const input = {
      requestId: '11111111-1111-4111-8111-111111111111',
      category: 'download' as const,
      title: '资源求助',
      content: '这是一条足够长的求助正文',
      patchId: 3,
      gameName: '',
      gameLinks: [],
      resourceId: 8
    }
    const seen: number[] = []
    const created: Record<string, unknown>[] = []
    let queries = 0
    const db = {
      help_post: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          throw new Error('stop-after-link')
        }
      },
      patch: { findUnique: async () => ({ id: 3, status: 0 }) },
      patch_resource: {
        findUnique: async ({ where }: { where: { id: number } }) => {
          seen.push(where.id)
          return where.id === 9 ? { patch_id: 3, status: 0 } : null
        }
      },
      $queryRaw: async () => {
        queries += 1
        return [{ user_resource_id: 9 }]
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
    }
    await expect(createHelpPost(input, 1, { db: db as never })).rejects.toThrow(
      'stop-after-link'
    )
    // The hop is one query. The second query locks that survivor row.
    expect(queries).toBe(2)
    expect(seen).toEqual([9])
    expect(created[0]?.resource_id).toBe(9)

    queries = 0
    await expect(
      createHelpPost({ ...input, resourceId: null }, 1, { db: db as never })
    ).rejects.toThrow('stop-after-link')
    expect(queries).toBe(0)
    expect(created.at(-1)?.resource_id).toBeNull()

    const missingTable = {
      ...db,
      $queryRaw: async () => {
        throw new Error('relation patch_resource_merge_record does not exist')
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(missingTable)
    }
    await expect(
      createHelpPost(input, 1, { db: missingTable as never })
    ).rejects.toThrow('patch_resource_merge_record')
  })
})

describe('official mirror merge workbench services', () => {
  type Row = Record<string, unknown> & { id: number }
  type LinkRow = Row & { resource_id: number }
  const cardRow = (overrides: Record<string, unknown> = {}): Row => ({
    id: 1,
    name: '本体',
    section: 'galgame',
    patch_id: 10,
    download: 1,
    user_id: 2,
    status: 0,
    note: '',
    type: ['pc'],
    language: ['ja-jp'],
    platform: ['windows'],
    publisher_left_at: null,
    created: at('2026-01-01T00:00:00.000Z'),
    updated: at('2026-01-02T00:00:00.000Z'),
    publisher_name: '发布者',
    role: 1,
    patch_name: '原游戏',
    patch_unique_id: 'abcd1234',
    patch_status: 0,
    ...overrides
  })
  const staffRow = (overrides: Record<string, unknown> = {}): Row =>
    cardRow({
      user_id: 8,
      role: 3,
      publisher_name: '站方',
      created: at('2026-03-01T00:00:00.000Z'),
      ...overrides
    })
  const linkRow = (overrides: Record<string, unknown> = {}): LinkRow => ({
    id: 11,
    resource_id: 1,
    storage: 'user',
    content: 'https://example.test/a',
    size: '',
    code: '',
    password: '',
    hash: '',
    version: 1,
    sort_order: 0,
    attached_at: at('2026-01-01T00:00:00.000Z'),
    content_changed_at: null,
    ...overrides
  })
  const recordRow = (overrides: Record<string, unknown> = {}) => ({
    user_resource_id: 1,
    staff_resource_id: 2,
    patch_id: 10,
    section: 'galgame',
    status: 'dismissed',
    detail: { contentConfirmed: false },
    handled_at: at('2026-04-01T00:00:00.000Z'),
    handled_by_user_id: 7,
    ...overrides
  })
  const idsIn = (values: unknown[]) =>
    values.filter((value): value is number => typeof value === 'number')
  const listInput = {
    tab: 'pending' as const,
    search: '',
    page: 1,
    limit: 20
  }

  beforeEach(() => {
    harness.reset()
  })

  describe('options and list share one recommendation', () => {
    const rows = [
      cardRow({ id: 1 }),
      staffRow({ id: 2, name: '本体 站方版' }),
      staffRow({ id: 3, name: '本体' }),
      staffRow({ id: 4, section: 'patch', name: '补丁' }),
      staffRow({ id: 5, name: '追加内容' })
    ]
    const links = [
      linkRow({ id: 11, resource_id: 1, size: '1 GB' }),
      linkRow({ id: 21, resource_id: 2, storage: 'touchgal', size: '1010 MB' }),
      linkRow({ id: 31, resource_id: 3, storage: 'touchgal' }),
      linkRow({ id: 41, resource_id: 4, storage: 'touchgal' }),
      linkRow({ id: 51, resource_id: 5, storage: 'touchgal', size: '300 MB' })
    ]
    const records = [
      recordRow({ staff_resource_id: 3 }),
      recordRow({
        staff_resource_id: 6,
        handled_at: at('2026-04-03T00:00:00.000Z'),
        handled_by_user_id: 8
      })
    ]
    const respond = (sql: string, values: unknown[]) => {
      const ids = idsIn(values)
      if (sql.includes('om:patch-cards')) return rows
      if (sql.includes('om:live-cards')) {
        return rows.filter((row) => row.section === 'galgame')
      }
      if (sql.includes('om:record-cards')) return []
      if (sql.includes('publisher_name')) {
        return rows.filter((row) => ids.includes(row.id))
      }
      if (sql.includes('FROM patch_resource_link')) {
        return links.filter((row) => ids.includes(row.resource_id))
      }
      if (sql.includes('om:open-cases'))
        return [{ case_id: 41, resource_id: 5 }]
      if (sql.includes('om:open-staff')) return [{ resource_id: 5 }]
      if (sql.includes('om:official-count')) return [{ patch_id: 10, total: 4 }]
      if (sql.includes('om:handlers')) {
        return [{ id: 7, name: '站方甲' }].filter((row) => ids.includes(row.id))
      }
      if (sql.includes('patch_resource_merge_record')) return records
      return []
    }

    it('lists every staff card of the game in order with blocks, flags and history', async () => {
      harness.setResponder(respond)
      const result = await getMergeOptions({ userResourceId: 1 })
      if (typeof result === 'string') throw new Error(result)
      expect(result.user).toMatchObject({
        id: 1,
        eligible: true,
        hasStaffBackup: false
      })
      expect(result.recommendState).toBe('recommended')
      expect(result.options.map((option) => option.staff.id)).toEqual([
        2, 3, 5, 4
      ])
      const [recommended, dismissed, blocked, otherSection] = result.options
      expect(recommended).toMatchObject({
        recommended: true,
        mergeable: true,
        dismissable: true,
        highConfidence: false,
        sameSection: true,
        record: null,
        blocks: [],
        hits: 6
      })
      expect(recommended?.staff.hasStaffBackup).toBe(true)
      expect(
        recommended?.signals.find((item) => item.signal === 'unique')
      ).toMatchObject({
        hit: false,
        user: ['2'],
        staff: ['1']
      })
      expect(
        recommended?.signals.find((item) => item.signal === 'size')
      ).toMatchObject({
        hit: true,
        user: ['1 GB'],
        staff: ['1010 MB']
      })
      expect(dismissed).toMatchObject({
        record: 'dismissed',
        mergeable: false,
        dismissable: false
      })
      expect(dismissed?.blocks.map((item) => item.code)).toContain(
        'pair_dismissed'
      )
      expect(blocked).toMatchObject({
        mergeable: false,
        dismissable: true,
        record: null
      })
      expect(blocked?.blocks.map((item) => item.code)).toEqual([
        'staff_case_open'
      ])
      expect(otherSection).toMatchObject({
        sameSection: false,
        mergeable: false,
        dismissable: false,
        blocks: [
          {
            code: 'section_mismatch',
            message: '与用户资源不在同一分区，不能合并'
          }
        ]
      })
      expect(result.history).toEqual([
        {
          staffResourceId: 6,
          staffName: '已删除的站方卡片 6',
          status: 'dismissed',
          handledAt: '2026-04-03T00:00:00.000Z',
          handledBy: null,
          movedLinkIds: []
        },
        {
          staffResourceId: 3,
          staffName: '本体',
          status: 'dismissed',
          handledAt: '2026-04-01T00:00:00.000Z',
          handledBy: { id: 7, name: '站方甲' },
          movedLinkIds: []
        }
      ])
      const openQuery = harness.queries.find((query) =>
        query.sql.includes('om:open-cases')
      )
      expect([...new Set(idsIn(openQuery?.values ?? []))].sort()).toEqual([
        2, 3, 5
      ])
      const json = JSON.stringify(result)
      expect(json).not.toMatch(/https?:/)
    })

    it('gives the list row the same recommendation and counts staff in both sections', async () => {
      harness.setResponder(respond)
      const options = await getMergeOptions({ userResourceId: 1 })
      if (typeof options === 'string') throw new Error(options)
      const listed = await listResourceMerges(listInput)
      const row = listed.items.find((item) => item.userResource.id === 1)
      expect(row).toMatchObject({
        recommendState: options.recommendState,
        recommendation: { staffResourceId: 2, staffName: '本体 站方版' },
        officialCount: options.options.length,
        hasStaffBackup: false,
        handledAt: null,
        handledBy: null
      })
      expect(
        row?.candidates.map((item) => item.staffResourceId).sort()
      ).toEqual([2, 5])
      expect(
        row?.candidates
          .find((item) => item.staffResourceId === 5)
          ?.blocks.map((item) => item.code)
      ).toEqual(['staff_case_open'])
    })
  })

  it('shows a survivor as ineligible with its merged history', async () => {
    const rows = [cardRow({ id: 1 }), staffRow({ id: 2 })]
    harness.setResponder((sql, values) => {
      const ids = idsIn(values)
      if (sql.includes('om:patch-cards')) return rows
      if (sql.includes('publisher_name'))
        return rows.filter((row) => ids.includes(row.id))
      if (sql.includes('FROM patch_resource_link')) {
        return [
          linkRow({ id: 11, resource_id: 1 }),
          linkRow({ id: 12, resource_id: 1, storage: 'touchgal' }),
          linkRow({ id: 21, resource_id: 2, storage: 'touchgal' })
        ].filter((row) => ids.includes(row.resource_id))
      }
      if (sql.includes('om:handlers')) return [{ id: 7, name: '站方甲' }]
      if (sql.includes('patch_resource_merge_record')) {
        return [
          recordRow({
            staff_resource_id: 9,
            status: 'merged',
            handled_at: at('2026-03-05T00:00:00.000Z'),
            detail: {
              movedLinkIds: [12],
              noteAppended: false,
              contentConfirmed: true,
              basis,
              sourceAuthorId: 8,
              likeCount: 0,
              userResourceId: 1,
              staffResourceId: 9
            }
          })
        ]
      }
      return []
    })
    const result = await getMergeOptions({ userResourceId: 1 })
    if (typeof result === 'string') throw new Error(result)
    expect(result.user).toMatchObject({ eligible: false, hasStaffBackup: true })
    expect(result.recommendState).toBe('none')
    expect(result.options[0]).toMatchObject({
      mergeable: false,
      dismissable: false,
      recommended: false
    })
    expect(result.options[0]?.blocks.map((item) => item.code)).toContain(
      'already_merged_other'
    )
    expect(result.history).toEqual([
      {
        staffResourceId: 9,
        staffName: '已合并的站方卡片 9',
        status: 'merged',
        handledAt: '2026-03-05T00:00:00.000Z',
        handledBy: { id: 7, name: '站方甲' },
        movedLinkIds: [12]
      }
    ])
  })

  it('returns an error string for a missing user card', async () => {
    harness.setResponder(() => [])
    expect(await getMergeOptions({ userResourceId: 404 })).toBe(
      '未找到对应的资源'
    )
  })

  describe('dismissMergeCard', () => {
    const rows = [
      cardRow({ id: 1 }),
      staffRow({ id: 2 }),
      staffRow({ id: 3 }),
      staffRow({ id: 4, section: 'patch' }),
      staffRow({ id: 6 }),
      cardRow({ id: 7, user_id: 3 })
    ]
    const links = [
      linkRow({ id: 11, resource_id: 1 }),
      linkRow({ id: 21, resource_id: 2, storage: 'touchgal' }),
      linkRow({ id: 31, resource_id: 3, storage: 'touchgal' }),
      linkRow({ id: 71, resource_id: 7 })
    ]
    const responder =
      (
        options: {
          cards?: typeof rows
          related?: Record<string, unknown>[]
          locked?: Record<string, unknown>[]
        } = {}
      ) =>
      (sql: string, values: unknown[]) => {
        const ids = idsIn(values)
        const cards = options.cards ?? rows
        if (sql.includes('om:lock-resources')) {
          return cards
            .filter((row) => ids.includes(row.id))
            .map((row) => ({ id: row.id }))
        }
        if (sql.includes('om:lock-merge-records')) {
          return options.locked ?? [recordRow({ staff_resource_id: 3 })]
        }
        if (sql.includes('INSERT INTO patch_resource_merge_record')) return 1
        if (sql.includes('publisher_name'))
          return cards.filter((row) => ids.includes(row.id))
        if (sql.includes('FROM patch_resource_link')) {
          return links.filter((row) => ids.includes(row.resource_id))
        }
        if (sql.includes('patch_resource_merge_record')) {
          return (
            options.related ?? [
              recordRow({ staff_resource_id: 3 }),
              recordRow({
                user_resource_id: 6,
                staff_resource_id: 50,
                status: 'merged',
                detail: {}
              })
            ]
          )
        }
        return []
      }

    it('dismisses the live pairs in one pass and reports the rest per pair', async () => {
      harness.setResponder(responder())
      const result = await dismissMergeCard(
        { userResourceId: 1, staffResourceIds: [7, 5, 4, 3, 2, 6] },
        9
      )
      expect(result).toEqual({
        changed: true,
        dismissed: [2],
        unchanged: [3],
        skipped: [
          { staffResourceId: 4, reason: '与用户资源不在同一分区，不能合并' },
          { staffResourceId: 5, reason: '未找到对应的资源' },
          { staffResourceId: 6, reason: '不能再次合并已留下的卡片' },
          { staffResourceId: 7, reason: '不是可合并的候选' }
        ]
      })
      const lockIndex = (marker: string) =>
        harness.queries.findIndex((query) => query.sql.includes(marker))
      const resourceLock = harness.queries[lockIndex('om:lock-resources')]
      expect(idsIn(resourceLock?.values ?? [])).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(lockIndex('om:lock-resources')).toBeLessThan(
        lockIndex('om:lock-merge-records')
      )
      expect(lockIndex('om:lock-merge-records')).toBeLessThan(
        lockIndex('om:lock-links')
      )
      const inserts = harness.queries.filter((query) =>
        query.sql.includes('INSERT INTO patch_resource_merge_record')
      )
      expect(inserts).toHaveLength(1)
      expect(inserts[0]?.values).toEqual(
        expect.arrayContaining([1, 2, 10, 'galgame', 9])
      )
      expect(inserts[0]?.sql).toContain("'dismissed'")
      expect(harness.logs).toEqual([
        {
          type: 'resource_merge_dismiss',
          user_id: 9,
          content: '管理员 站方 驳回了资源 1 与站方资源 2 的合并。'
        }
      ])
    })

    it('writes nothing when every listed pair is already dismissed', async () => {
      harness.setResponder(responder())
      expect(
        await dismissMergeCard({ userResourceId: 1, staffResourceIds: [3] }, 9)
      ).toEqual({ changed: false, dismissed: [], unchanged: [3], skipped: [] })
      expect(harness.logs).toHaveLength(0)
      expect(
        harness.queries.some((query) =>
          query.sql.includes('INSERT INTO patch_resource_merge_record')
        )
      ).toBe(false)
    })

    it('rejects the whole request on a user-side failure', async () => {
      const cases: [Parameters<typeof responder>[0], string][] = [
        [
          {
            cards: rows.map((row) =>
              row.id === 1
                ? { ...row, publisher_left_at: at('2026-04-01T00:00:00.000Z') }
                : row
            )
          },
          '用户卡片已交接'
        ],
        [
          {
            cards: rows.map((row) =>
              row.id === 1 ? { ...row, status: 1 } : row
            )
          },
          '用户卡片未公开'
        ],
        [{ cards: rows.filter((row) => row.id !== 1) }, '未找到对应的资源'],
        [
          {
            cards: rows.map((row) => (row.id === 1 ? { ...row, role: 3 } : row))
          },
          '不是可合并的候选'
        ],
        [
          {
            related: [
              recordRow({ staff_resource_id: 99, status: 'merged', detail: {} })
            ]
          },
          '已与其他卡片合并'
        ]
      ]
      for (const [options, message] of cases) {
        harness.reset()
        harness.setResponder(responder(options))
        expect(
          await dismissMergeCard(
            { userResourceId: 1, staffResourceIds: [2, 3] },
            9
          )
        ).toBe(message)
        expect(harness.logs).toHaveLength(0)
        expect(
          harness.queries.some((query) =>
            query.sql.includes('INSERT INTO patch_resource_merge_record')
          )
        ).toBe(false)
      }
    })
  })

  it('filters recommended rows before pagination without including high-confidence or blocked rows', async () => {
    const rows = [
      cardRow({ id: 1, patch_id: 10, download: 5 }),
      staffRow({ id: 2, patch_id: 10, language: ['en-us'] }),
      cardRow({ id: 3, patch_id: 20, download: 9 }),
      staffRow({ id: 4, patch_id: 20, language: ['en-us'] }),
      cardRow({ id: 5, patch_id: 30, download: 20 }),
      staffRow({ id: 6, patch_id: 30 }),
      cardRow({ id: 7, patch_id: 40, download: 30 }),
      staffRow({
        id: 8,
        patch_id: 40,
        language: ['en-us'],
        platform: ['linux']
      }),
      cardRow({ id: 9, patch_id: 50, download: 40 }),
      staffRow({ id: 10, patch_id: 50 })
    ]
    const links = rows.map((row) =>
      linkRow({
        id: row.id * 10,
        resource_id: row.id,
        storage: Number(row.role) >= 3 ? 'touchgal' : 'user'
      })
    )
    harness.setResponder((sql, values) => {
      if (sql.includes('om:live-cards')) return rows
      if (sql.includes('FROM patch_resource_link')) {
        return links.filter((row) => idsIn(values).includes(row.resource_id))
      }
      if (sql.includes('om:open-staff')) return [{ resource_id: 10 }]
      return []
    })

    const input = mergeListSchema.parse({
      ...listInput,
      pairClass: 'recommended',
      limit: 1
    })
    const first = await listResourceMerges(input)
    const second = await listResourceMerges({ ...input, page: 2 })
    expect(first.total).toBe(2)
    expect(first.counts.pending).toBe(5)
    expect(first.items.map((row) => row.userResource.id)).toEqual([3])
    expect(second.items.map((row) => row.userResource.id)).toEqual([1])
    expect(first.items[0]).toMatchObject({
      pairClass: 'manual',
      recommendState: 'recommended',
      recommendation: { staffResourceId: 4 }
    })
    const high = await listResourceMerges({ ...input, pairClass: 'high' })
    expect(high.items.map((row) => row.userResource.id)).toEqual([9])
    const searched = await listResourceMerges({ ...input, search: 'no-match' })
    expect(searched.total).toBe(0)
    expect(searched.items).toEqual([])
  })

  describe('list sort and history fields', () => {
    const pendingRows = [
      cardRow({ id: 1, patch_id: 10, patch_name: 'B游戏', download: 5 }),
      staffRow({
        id: 2,
        patch_id: 10,
        patch_name: 'B游戏',
        created: at('2026-03-03T00:00:00.000Z')
      }),
      cardRow({ id: 3, patch_id: 20, patch_name: 'A游戏', download: 5 }),
      staffRow({
        id: 4,
        patch_id: 20,
        patch_name: 'A游戏',
        created: at('2026-03-01T00:00:00.000Z')
      }),
      cardRow({ id: 5, patch_id: 30, patch_name: 'C游戏', download: 9 }),
      staffRow({
        id: 6,
        patch_id: 30,
        patch_name: 'C游戏',
        created: at('2026-03-02T00:00:00.000Z')
      })
    ]
    const pendingLinks = [
      linkRow({ id: 11, resource_id: 1 }),
      linkRow({ id: 12, resource_id: 1, storage: 'touchgal' }),
      linkRow({ id: 21, resource_id: 2, storage: 'touchgal' }),
      linkRow({ id: 31, resource_id: 3 }),
      linkRow({ id: 41, resource_id: 4, storage: 'touchgal' }),
      linkRow({ id: 51, resource_id: 5 }),
      linkRow({ id: 61, resource_id: 6, storage: 'touchgal' })
    ]

    it('orders pending rows by each sort with the user id as the final order', async () => {
      harness.setResponder((sql, values) => {
        const ids = idsIn(values)
        if (sql.includes('om:live-cards')) return pendingRows
        if (sql.includes('FROM patch_resource_link')) {
          return pendingLinks.filter((row) => ids.includes(row.resource_id))
        }
        if (sql.includes('om:official-count')) {
          return [
            { patch_id: 10, total: 2 },
            { patch_id: 20, total: 1 },
            { patch_id: 30, total: 1 }
          ]
        }
        return []
      })
      const order = async (
        sort?:
          | 'download_desc'
          | 'waiting_longest'
          | 'game_name'
          | 'handled_desc'
      ) =>
        (await listResourceMerges({ ...listInput, sort })).items.map(
          (item) => item.userResource.id
        )
      expect(await order()).toEqual([5, 1, 3])
      expect(await order('download_desc')).toEqual([5, 1, 3])
      expect(await order('waiting_longest')).toEqual([3, 5, 1])
      expect(await order('game_name')).toEqual([3, 1, 5])
      expect(await order('handled_desc')).toEqual([5, 1, 3])
      const listed = await listResourceMerges(listInput)
      const first = listed.items.find((item) => item.userResource.id === 1)
      expect(first).toMatchObject({
        officialCount: 2,
        hasStaffBackup: true,
        recommendState: 'recommended',
        recommendation: { staffResourceId: 2 },
        pairClass: 'high',
        handledAt: null,
        handledBy: null
      })
      expect(listed.oldestPending).toMatchObject({
        resourceId: 3,
        since: '2026-03-01T00:00:00.000Z'
      })
    })

    it('orders history rows by the latest or earliest record and names the latest handler', async () => {
      const userRows = [
        cardRow({ id: 1, patch_name: 'B游戏' }),
        cardRow({ id: 3, patch_id: 20, patch_name: 'A游戏' })
      ]
      harness.setResponder((sql, values) => {
        const ids = idsIn(values)
        if (sql.includes('om:merge-history')) {
          return [
            recordRow({ user_resource_id: 1, staff_resource_id: 2 }),
            recordRow({
              user_resource_id: 1,
              staff_resource_id: 8,
              handled_at: at('2026-04-05T00:00:00.000Z'),
              handled_by_user_id: 9
            }),
            recordRow({
              user_resource_id: 3,
              staff_resource_id: 4,
              patch_id: 20,
              handled_at: at('2026-03-20T00:00:00.000Z')
            })
          ]
        }
        if (sql.includes('om:record-cards'))
          return userRows.filter((row) => ids.includes(row.id))
        if (sql.includes('om:handlers')) {
          return [
            { id: 7, name: '站方甲' },
            { id: 9, name: '站方乙' }
          ].filter((row) => ids.includes(row.id))
        }
        if (sql.includes('FROM patch_resource_link')) {
          return [
            linkRow({ id: 11, resource_id: 1 }),
            linkRow({ id: 31, resource_id: 3 })
          ].filter((row) => ids.includes(row.resource_id))
        }
        return []
      })
      const history = { ...listInput, tab: 'dismissed' as const }
      const latest = await listResourceMerges(history)
      expect(latest.items.map((item) => item.userResource.id)).toEqual([1, 3])
      expect(latest.items[0]).toMatchObject({
        handledAt: '2026-04-05T00:00:00.000Z',
        handledBy: { id: 9, name: '站方乙' },
        recommendState: null,
        recommendation: null,
        candidateCount: 2
      })
      expect(
        latest.items[0]?.candidates.find((item) => item.staffResourceId === 8)
          ?.staffName
      ).toBe('已删除的站方卡片 8')
      expect(latest.items[1]).toMatchObject({
        handledAt: '2026-03-20T00:00:00.000Z',
        handledBy: { id: 7, name: '站方甲' }
      })
      const earliest = await listResourceMerges({
        ...history,
        sort: 'waiting_longest'
      })
      expect(earliest.items.map((item) => item.userResource.id)).toEqual([3, 1])
      expect(latest.counts).toEqual({ pending: 0, dismissed: 2, merged: 0 })
    })
  })

  it('reports likes on the staff card in the preview', async () => {
    const spy = vi
      .spyOn(harness.tx.user_patch_resource_like_relation, 'count')
      .mockResolvedValue(3)
    harness.setResponder((sql, values) => {
      const ids = idsIn(values)
      const rows = [cardRow({ id: 1 }), staffRow({ id: 2 })]
      if (sql.includes('FROM ops_case')) return []
      if (sql.includes('publisher_name')) {
        return sql.includes('r.patch_id =')
          ? rows
          : rows.filter((row) => ids.includes(row.id))
      }
      if (sql.includes('FROM patch_resource_link')) {
        return [
          linkRow({ id: 11, resource_id: 1 }),
          linkRow({ id: 21, resource_id: 2, storage: 'touchgal' })
        ]
      }
      return []
    })
    const preview = await previewResourceMerge({
      userResourceId: 1,
      staffResourceId: 2
    })
    expect(preview).toMatchObject({ staffLikeCount: 3, classification: 'high' })
    expect(spy).toHaveBeenCalledWith({ where: { resource_id: 2 } })
    spy.mockRestore()
  })

  describe('merge detail recommendation', () => {
    const user = cardRow({ id: 1 })
    const staff = staffRow({ id: 2 })
    const rival = staffRow({ id: 3 })
    const links = [
      linkRow({ id: 11, resource_id: 1 }),
      linkRow({ id: 21, resource_id: 2, storage: 'touchgal' }),
      linkRow({ id: 31, resource_id: 3, storage: 'touchgal' })
    ]
    const asCard = (row: Record<string, unknown>) => {
      const value = rowCard(row, [])
      if (!value) throw new Error('bad row')
      return {
        ...value,
        links: links.flatMap((item) => {
          const parsed = rowLink(item)
          return parsed && parsed.resourceId === value.id ? [parsed] : []
        })
      }
    }
    const digest = mergeBasis({
      user: asCard(user),
      staff: asCard(staff),
      openCases: []
    })
    const run = async (game: Record<string, unknown>[]) => {
      harness.reset()
      harness.setResponder((sql, values) => {
        const ids = idsIn(values)
        if (sql.includes('INSERT INTO patch_resource_merge_record'))
          return [{ id: 80 }]
        if (sql.includes('om:lock-resources')) return [{ id: 1 }, { id: 2 }]
        if (sql.includes('r.patch_id =')) return game
        if (sql.includes('publisher_name')) return [user, staff]
        if (sql.includes('FROM patch_resource_link')) {
          return links.filter((row) => ids.includes(row.resource_id))
        }
        return []
      })
      const result = await mergeStaffIntoUser(
        {
          userResourceId: 1,
          staffResourceId: 2,
          basis: digest,
          contentConfirmed: true
        },
        7
      )
      expect(result).toMatchObject({ alreadyMerged: false, movedLinkIds: [21] })
      const insert = harness.queries.find((query) =>
        query.sql.includes('INSERT INTO patch_resource_merge_record')
      )
      const json = insert?.values.find(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('{')
      )
      return JSON.parse(json ?? '{}') as Record<string, unknown>
    }

    it('moves the original staff link without rewriting its backup timestamps', async () => {
      const update = vi.spyOn(harness.tx.patch_resource_link, 'update')
      try {
        await run([user, staff])
        expect(update).toHaveBeenCalledExactlyOnceWith({
          where: { id: links[1].id },
          data: { resource_id: 1, sort_order: expect.any(Number) }
        })
      } finally {
        update.mockRestore()
      }
    })

    it('preserves the original link snapshot in merge history', async () => {
      const history = vi.spyOn(harness.tx.patch_resource_link_history, 'create')
      try {
        await run([user, staff])
        expect(history).toHaveBeenCalledExactlyOnceWith({
          data: {
            resource_id: 1,
            link_id: links[1].id,
            from_version: links[1].version,
            old_content: links[1].content,
            old_storage: links[1].storage,
            old_size: links[1].size,
            reason: 'merge',
            operator_user_id: 7
          }
        })
      } finally {
        history.mockRestore()
      }
    })

    it('records whether the merged pair was the recommendation without changing acceptance', async () => {
      const alone = await run([user, staff])
      expect(alone.recommended).toBe(true)
      expect(Object.keys(alone).sort()).toEqual([
        'basis',
        'contentConfirmed',
        'likeCount',
        'movedLinkIds',
        'noteAppended',
        'recommended',
        'sourceAuthorId',
        'staffResourceId',
        'userResourceId'
      ])
      const close = await run([user, staff, rival])
      expect(close.recommended).toBe(false)
    })

    it('still parses and replays details written before the key existed', async () => {
      const old = {
        movedLinkIds: [4],
        noteAppended: false,
        contentConfirmed: true,
        basis,
        sourceAuthorId: 8,
        likeCount: 3,
        userResourceId: 1,
        staffResourceId: 2
      }
      expect(parseMergeDetail(old)).toEqual(old)
      expect(
        parseMergeDetail(JSON.stringify({ ...old, recommended: true }))
      ).toEqual({
        ...old,
        recommended: true
      })
      expect(parseMergeDetail({ ...old, recommended: 'yes' })).toEqual(old)
      harness.setResponder((sql) => {
        if (sql.includes('om:lock-merge-record')) {
          return [
            recordRow({
              status: 'merged',
              detail: { ...old, recommended: false }
            })
          ]
        }
        if (sql.includes('unique_id')) {
          return [
            { id: 1, section: 'galgame', patch_id: 10, unique_id: 'abcd1234' }
          ]
        }
        return []
      })
      expect(
        await mergeStaffIntoUser(
          { userResourceId: 1, staffResourceId: 2, ...confirmed },
          7
        )
      ).toMatchObject({ alreadyMerged: true, movedLinkIds: [4] })
    })
  })
})
