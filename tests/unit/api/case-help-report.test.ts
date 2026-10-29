import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same database stand-in as case-feedback-service.test.ts, plus the help
// tables and the module 07 moderation primitives the case service calls.
const mocks = vi.hoisted(() => {
  const queryState = {
    missingUserIds: [] as number[],
    handoffRows: [] as Array<{ case_id: number; payload: unknown }>
  }
  const tx = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    ops_case: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
      fields: { revision: { name: 'revision' } }
    },
    ops_case_message: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn()
    },
    ops_case_subscriber: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn()
    },
    patch_resource: { findUnique: vi.fn(), findMany: vi.fn() },
    patch: { findUnique: vi.fn(), findMany: vi.fn() },
    patch_comment: { findUnique: vi.fn() },
    patch_rating: { findUnique: vi.fn() },
    shoutbox: { findUnique: vi.fn() },
    help_post: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    help_answer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    help_reply: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    user_message: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    admin_log: { create: vi.fn() }
  }
  return {
    tx,
    queryState,
    consumeCaseImageUploads: vi.fn(),
    restoreCaseImageUploads: vi.fn(),
    checkCaseRateLimit: vi.fn(),
    deleteReportedTargetInTransaction: vi.fn(),
    removeShoutboxForCase: vi.fn(),
    restoreShoutboxForCase: vi.fn(),
    hideHelpTargetForCase: vi.fn(),
    restoreHelpTargetForCase: vi.fn(),
    isHelpTargetHidden: vi.fn(),
    applyHelpReportThreshold: vi.fn()
  }
})

vi.mock('~/prisma', () => ({ prisma: mocks.tx }))
vi.mock('~/prisma/index', () => ({ prisma: mocks.tx }))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  updatePatchAttributes: vi.fn()
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))
vi.mock('~/app/api/case/imageUpload', () => ({
  caseImageUrl: (key: string) => `https://img.example/${key}`,
  consumeCaseImageUploads: mocks.consumeCaseImageUploads,
  restoreCaseImageUploads: mocks.restoreCaseImageUploads
}))
vi.mock('~/app/api/case/rateLimit', () => ({
  checkCaseRateLimit: mocks.checkCaseRateLimit
}))
vi.mock('~/app/api/admin/report/service', () => ({
  deleteReportedTargetInTransaction: mocks.deleteReportedTargetInTransaction
}))
vi.mock('~/app/api/shoutbox/service', () => ({
  removeShoutboxForCase: mocks.removeShoutboxForCase,
  restoreShoutboxForCase: mocks.restoreShoutboxForCase
}))
vi.mock('~/app/api/shoutbox/cache', () => ({
  invalidateShoutboxCaches: vi.fn()
}))

vi.mock('~/app/api/help/moderation', () => ({
  hideHelpTargetForCase: mocks.hideHelpTargetForCase,
  restoreHelpTargetForCase: mocks.restoreHelpTargetForCase,
  isHelpTargetHidden: mocks.isHelpTargetHidden,
  applyHelpReportThreshold: mocks.applyHelpReportThreshold
}))

import {
  createCase,
  getCase,
  handleCaseAsAdmin,
  handleCaseContent
} from '~/app/api/case/service'
import { createCaseSchema } from '~/validations/case'

const now = new Date('2026-09-26T08:00:00.000Z')
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000)

const caseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  kind: 'resource_mismatch',
  target_type: 'resource',
  target_id: 100,
  patch_id: 7,
  owner_type: 'publisher',
  owner_id: 2,
  status: 'open',
  resolution: null,
  public: true,
  source: 'user',
  dedup_key: 'resource:100:resource_mismatch',
  daily_key: null,
  revision: 3,
  status_changed_at: hoursAgo(1),
  queue_entered_at: hoursAgo(1),
  closed_at: null,
  escalated_at: null,
  first_owner_response_at: null,
  hidden_at: null,
  restored_at: null,
  reopened_count: 0,
  reminded_revision: null,
  reporter_id: 5,
  owner: { id: 2, name: '发布者', avatar: '', role: 1 },
  reporter: { id: 5, name: '报告者', avatar: '', role: 1 },
  _count: { subscribers: 1 },
  messages: [],
  created: hoursAgo(1),
  updated: hoursAgo(1),
  ...overrides
})

const resourceRow = {
  id: 100,
  name: '资源 X',
  section: 'galgame',
  patch_id: 7,
  user_id: 2,
  status: 0,
  user: { role: 1 },
  patch: { id: 7, unique_id: 'abcd1234', name: '条目 A' }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryState.missingUserIds = []
  mocks.queryState.handoffRows = []
  mocks.tx.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(mocks.tx)
  )
  mocks.tx.$queryRaw.mockImplementation(
    (query: { strings?: readonly string[]; values?: readonly unknown[] }) => {
      const sql = query.strings?.join(' ') ?? ''
      if (sql.includes('FOR KEY SHARE')) {
        const ids = (query.values ?? []).filter(
          (value): value is number => typeof value === 'number'
        )
        const missing = new Set(mocks.queryState.missingUserIds)
        return Promise.resolve(
          ids.filter((id) => !missing.has(id)).map((id) => ({ id }))
        )
      }
      if (sql.includes('CROSS JOIN LATERAL')) {
        const ids = new Set(query.values ?? [])
        return Promise.resolve(
          mocks.queryState.handoffRows.filter((row) => ids.has(row.case_id))
        )
      }
      if (sql.includes('FROM patch_resource') && sql.includes('FOR UPDATE')) {
        return Promise.resolve([resourceRow])
      }
      return Promise.resolve([{}])
    }
  )
  mocks.tx.ops_case.findUnique.mockResolvedValue(caseRow())
  mocks.tx.ops_case.findMany.mockResolvedValue([])
  mocks.tx.ops_case.createMany.mockResolvedValue({ count: 1 })
  mocks.tx.ops_case.count.mockResolvedValue(0)
  mocks.tx.ops_case.groupBy.mockResolvedValue([])
  mocks.tx.ops_case.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.ops_case_message.create.mockResolvedValue({
    id: 60,
    kind: 'reply',
    event: null,
    payload: null,
    body: '',
    created: now,
    author: null,
    images: []
  })
  mocks.tx.ops_case_message.findMany.mockResolvedValue([])
  mocks.tx.ops_case_message.findFirst.mockResolvedValue(null)
  mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue(null)
  mocks.tx.ops_case_subscriber.findFirst.mockResolvedValue(null)
  mocks.tx.ops_case_subscriber.findMany.mockResolvedValue([{ user_id: 5 }])
  mocks.tx.ops_case_subscriber.createMany.mockResolvedValue({ count: 1 })
  mocks.tx.ops_case_subscriber.count.mockResolvedValue(0)
  mocks.tx.ops_case_subscriber.deleteMany.mockResolvedValue({ count: 1 })
  mocks.tx.patch_resource.findUnique.mockResolvedValue(resourceRow)
  mocks.tx.patch_rating.findUnique.mockResolvedValue({ id: 200 })
  mocks.tx.patch.findUnique.mockResolvedValue({
    id: 7,
    unique_id: 'abcd1234',
    name: '条目 A',
    status: 0
  })
  mocks.tx.patch.findMany.mockResolvedValue([])
  mocks.tx.user.findMany.mockImplementation(
    (args: { where?: { id?: { in?: number[] } } }) => {
      const ids = args.where?.id?.in
      const missing = new Set(mocks.queryState.missingUserIds)
      if (ids) {
        return Promise.resolve(
          ids.filter((id) => !missing.has(id)).map((id) => ({ id }))
        )
      }
      return Promise.resolve(
        [90, 91].filter((id) => !missing.has(id)).map((id) => ({ id }))
      )
    }
  )
  mocks.tx.user_message.createMany.mockResolvedValue({ count: 1 })
  mocks.tx.user_message.findMany.mockResolvedValue([])
  mocks.tx.user_message.updateMany.mockResolvedValue({ count: 0 })
  mocks.consumeCaseImageUploads.mockResolvedValue(null)
  mocks.restoreCaseImageUploads.mockResolvedValue(undefined)
  mocks.checkCaseRateLimit.mockResolvedValue(null)
  mocks.deleteReportedTargetInTransaction.mockResolvedValue(true)
  mocks.tx.ops_case_message.updateMany.mockResolvedValue({ count: 1 })
  mocks.applyHelpReportThreshold.mockResolvedValue(false)
  mocks.isHelpTargetHidden.mockResolvedValue(false)
  mocks.hideHelpTargetForCase.mockResolvedValue(true)
  mocks.restoreHelpTargetForCase.mockResolvedValue(true)
  mocks.tx.help_post.findMany.mockResolvedValue([])
  mocks.tx.help_answer.findMany.mockResolvedValue([])
})

const helpCase = (overrides: Record<string, unknown> = {}) =>
  caseRow({
    kind: 'content_violation',
    target_type: 'help',
    target_id: 300,
    patch_id: null,
    owner_type: 'staff',
    owner_id: null,
    public: false,
    dedup_key: 'help:300:content_violation',
    ...overrides
  })

const postRow = (overrides: Record<string, unknown> = {}) => ({
  id: 300,
  user_id: 8,
  title: '求助标题',
  content: '正文',
  hidden_at: null,
  deleted_at: null,
  patch: null,
  user: { id: 8, name: '提问者', avatar: '' },
  ...overrides
})

const db = () => mocks.tx as never

describe('help report cases (03 §12.2 求助举报)', () => {
  it('accepts help, help_answer and help_reply targets in the public schema', () => {
    for (const targetType of ['help', 'help_answer', 'help_reply']) {
      expect(
        createCaseSchema.safeParse({
          kind: 'content_violation',
          targetType,
          targetId: 300,
          content: '这里有违规广告链接'
        }).success
      ).toBe(true)
    }
    expect(
      createCaseSchema.safeParse({
        kind: 'resource_mismatch',
        targetType: 'help',
        targetId: 300,
        content: '这里有违规广告链接'
      }).success
    ).toBe(false)
  })

  it('opens a private staff case and runs the help threshold', async () => {
    mocks.tx.ops_case.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(helpCase())
    mocks.tx.help_post.findUnique.mockResolvedValue(postRow())
    mocks.applyHelpReportThreshold.mockResolvedValue(true)

    const result = await createCase(
      {
        kind: 'content_violation',
        targetType: 'help',
        targetId: 300,
        content: '这里有违规广告链接'
      },
      5,
      { now, db: db() }
    )

    expect(typeof result).toBe('object')
    expect(mocks.tx.ops_case.createMany.mock.calls[0][0].data[0]).toMatchObject(
      {
        kind: 'content_violation',
        target_type: 'help',
        owner_type: 'staff',
        public: false,
        patch_id: null,
        dedup_key: 'help:300:content_violation'
      }
    )
    expect(mocks.applyHelpReportThreshold).toHaveBeenCalledWith(
      mocks.tx,
      'help',
      300,
      42,
      now
    )
    // The temporary hide is recorded on this case so 不成立 can undo it.
    expect(mocks.tx.ops_case.updateMany).toHaveBeenCalledWith({
      where: { id: 42, hidden_at: null },
      data: { hidden_at: now }
    })
  })

  it('refuses reporting an own or a deleted post', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(null)
    mocks.tx.help_post.findUnique.mockResolvedValue(postRow({ user_id: 5 }))
    const input = {
      kind: 'content_violation' as const,
      targetType: 'help' as const,
      targetId: 300,
      content: '这里有违规广告链接'
    }

    await expect(createCase(input, 5, { now, db: db() })).resolves.toBe(
      '不能举报自己的求助'
    )
    mocks.tx.help_post.findUnique.mockResolvedValue(
      postRow({ deleted_at: now })
    )
    await expect(createCase(input, 5, { now, db: db() })).resolves.toBe(
      '求助不存在或已删除'
    )
    expect(mocks.tx.ops_case.createMany).not.toHaveBeenCalled()
  })

  it('hides through the violation action and closes as 违规隐藏', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(helpCase())
    mocks.tx.help_post.findUnique.mockResolvedValue(postRow())

    await expect(
      handleCaseContent(
        { caseId: 42, action: 'hide', content: '广告' },
        90,
        3,
        {
          now,
          db: db()
        }
      )
    ).resolves.toMatchObject({ changed: true, action: 'hide' })
    expect(mocks.hideHelpTargetForCase).toHaveBeenCalledWith(
      mocks.tx,
      'help',
      300,
      now
    )
    const close = mocks.tx.ops_case.updateMany.mock.calls.find(
      ([args]) => args.data?.resolution
    )
    expect(close?.[0].data).toMatchObject({
      status: 'resolved',
      resolution: 'violation_hidden'
    })
  })

  it('restores only a hide this case caused', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      helpCase({ hidden_at: null })
    )
    mocks.tx.help_post.findUnique.mockResolvedValue(postRow({ hidden_at: now }))

    await expect(
      handleCaseContent({ caseId: 42, action: 'restore', content: '' }, 90, 3, {
        now,
        db: db()
      })
    ).resolves.toBe('该隐藏不是本问题造成的，不能通过本问题恢复')
    expect(mocks.restoreHelpTargetForCase).not.toHaveBeenCalled()

    mocks.tx.ops_case.findUnique.mockResolvedValue(
      helpCase({ hidden_at: hoursAgo(1) })
    )
    await expect(
      handleCaseContent({ caseId: 42, action: 'restore', content: '' }, 90, 3, {
        now,
        db: db()
      })
    ).resolves.toMatchObject({ changed: true, action: 'restore' })
    const close = mocks.tx.ops_case.updateMany.mock.calls.find(
      ([args]) => args.data?.resolution
    )
    expect(close?.[0].data).toMatchObject({
      status: 'rejected',
      resolution: 'not_established'
    })
  })

  it('refuses a plain conclusion while the target is hidden', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(helpCase())
    mocks.tx.help_post.findUnique.mockResolvedValue(postRow())
    mocks.isHelpTargetHidden.mockResolvedValue(true)

    await expect(
      handleCaseAsAdmin(
        {
          caseId: 42,
          action: 'resolve',
          resolution: 'not_established',
          content: '不构成违规'
        },
        90,
        3,
        { now, db: db() }
      )
    ).resolves.toBe('隐藏中的求助内容必须判定违规或恢复显示')

    mocks.isHelpTargetHidden.mockResolvedValue(false)
    await expect(
      handleCaseAsAdmin(
        {
          caseId: 42,
          action: 'resolve',
          resolution: 'handled',
          content: '已与作者沟通'
        },
        90,
        3,
        { now, db: db() }
      )
    ).resolves.toMatchObject({ changed: true })
  })

  it('offers hide and restore by the target state, with a snapshot for staff', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(helpCase())
    mocks.tx.help_post.findUnique.mockResolvedValue(postRow({ hidden_at: now }))

    const detail = await getCase(42, 90, 3, { db: db() })

    expect(typeof detail).toBe('object')
    const view = (detail as Exclude<typeof detail, string>).case
    expect(view.capabilities.allowedContentActions).toEqual(['hide', 'restore'])
    expect(view.capabilities.allowedResolutions).toEqual([])
    expect(view.target).toMatchObject({
      targetType: 'help',
      status: 2,
      helpPostId: 300,
      content: { text: '求助标题 正文' }
    })
  })

  it('derives a reply report from its post and refuses deleted answers', async () => {
    mocks.tx.ops_case.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(
        helpCase({ target_type: 'help_reply', target_id: 77, patch_id: 7 })
      )
    const reply = (answerDeleted: Date | null) => ({
      id: 77,
      user_id: 8,
      content: '回复内容',
      hidden_at: null,
      deleted_at: null,
      user: { id: 8, name: '回复者', avatar: '' },
      answer: {
        post_id: 300,
        deleted_at: answerDeleted,
        post: {
          deleted_at: null,
          patch: { id: 7, unique_id: 'abcd1234', name: '条目 A' }
        }
      }
    })
    mocks.tx.help_reply.findUnique.mockResolvedValue(reply(null))
    const input = {
      kind: 'content_violation' as const,
      targetType: 'help_reply' as const,
      targetId: 77,
      content: '回复里有违规广告链接'
    }

    await createCase(input, 5, { now, db: db() })
    expect(mocks.tx.ops_case.createMany.mock.calls[0][0].data[0]).toMatchObject(
      { target_type: 'help_reply', patch_id: 7, owner_type: 'staff' }
    )

    mocks.tx.ops_case.createMany.mockClear()
    mocks.tx.ops_case.findUnique.mockResolvedValue(null)
    mocks.tx.help_reply.findUnique.mockResolvedValue(reply(now))
    await expect(createCase(input, 5, { now, db: db() })).resolves.toBe(
      '回复不存在或已删除'
    )
    expect(mocks.tx.ops_case.createMany).not.toHaveBeenCalled()
  })
})
