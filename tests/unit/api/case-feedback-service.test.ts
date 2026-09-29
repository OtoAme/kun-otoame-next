import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
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
    shoutbox: { findUnique: vi.fn() },
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
    consumeCaseImageUploads: vi.fn(),
    restoreCaseImageUploads: vi.fn(),
    checkCaseRateLimit: vi.fn(),
    deleteReportedTargetInTransaction: vi.fn(),
    removeShoutboxForCase: vi.fn(),
    restoreShoutboxForCase: vi.fn()
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

import { Prisma } from '@prisma/client'
import {
  appendCaseMessage,
  buildCaseDedupKey,
  confirmCase,
  createCase,
  getCase,
  getPublicResourceCaseBadges,
  handleCaseAsAdmin,
  handleCaseContent,
  handleCaseResource,
  proposeCaseClosure,
  remindCase,
  reopenCase,
  resolveCase,
  reviewCase,
  setCaseMessageHidden,
  timeoutCloseCase,
  withdrawCase
} from '~/app/api/case/service'
import { CASE_GUIDE_LINKS, CASE_QUICK_REPLIES } from '~/constants/case'
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

const createdMessages = () =>
  mocks.tx.ops_case_message.create.mock.calls.map(
    ([args]) => args.data as Record<string, unknown>
  )

const noticeRows = () =>
  mocks.tx.user_message.createMany.mock.calls.flatMap(
    ([args]) => args.data as Array<Record<string, unknown>>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tx.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(mocks.tx)
  )
  mocks.tx.$queryRaw.mockResolvedValue([{}])
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
  mocks.tx.patch.findUnique.mockResolvedValue({
    id: 7,
    unique_id: 'abcd1234',
    name: '条目 A',
    status: 0
  })
  mocks.tx.patch.findMany.mockResolvedValue([])
  mocks.tx.user.findMany.mockResolvedValue([{ id: 90 }, { id: 91 }])
  mocks.tx.user_message.createMany.mockResolvedValue({ count: 1 })
  mocks.tx.user_message.findMany.mockResolvedValue([])
  mocks.tx.user_message.updateMany.mockResolvedValue({ count: 0 })
  mocks.consumeCaseImageUploads.mockResolvedValue(null)
  mocks.restoreCaseImageUploads.mockResolvedValue(undefined)
  mocks.checkCaseRateLimit.mockResolvedValue(null)
  mocks.deleteReportedTargetInTransaction.mockResolvedValue(true)
  mocks.tx.ops_case_message.updateMany.mockResolvedValue({ count: 1 })
})

describe('case feedback rules (M03-6, M03-7)', () => {
  it('gives each opener their own entry-suggestion and site-feedback case', () => {
    expect(buildCaseDedupKey('patch', 7, 'patch_info', 5)).toBe(
      'patch:7:patch_info:5'
    )
    expect(buildCaseDedupKey('site', 0, 'other', 5)).toBe('site:0:other:5')
    // D26: other feedback on a game is scoped to its opener too.
    expect(buildCaseDedupKey('patch', 7, 'other', 5)).toBe('patch:7:other:5')
    expect(buildCaseDedupKey('resource', 100, 'resource_mismatch', 5)).toBe(
      'resource:100:resource_mismatch'
    )
  })

  it('pins site feedback to target 0 and still validates other targets', () => {
    expect(
      createCaseSchema.parse({
        kind: 'other',
        targetType: 'site',
        targetId: 99,
        content: '希望修改一下用户名称'
      })
    ).toMatchObject({ targetType: 'site', targetId: 0 })
    expect(
      createCaseSchema.safeParse({
        kind: 'other',
        targetType: 'patch',
        content: '这里的信息需要核对'
      }).success
    ).toBe(false)
    expect(
      createCaseSchema.safeParse({
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 1,
        content: '描述写的是完整版，实际只有体验版',
        imageKeys: [
          'case/5/1-a.avif',
          'case/5/2-b.avif',
          'case/5/3-c.avif',
          'case/5/4-d.avif'
        ]
      }).success
    ).toBe(false)
  })

  it('keeps a later reporter note on the case without state change or notice', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ reporter_id: 8, _count: { subscribers: 1 } })
    )

    const result = await createCase(
      {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 100,
        content: '第 3 分卷校验失败，重新下载也一样',
        imageKeys: ['case/5/1-a.avif']
      },
      5,
      { now, db: mocks.tx as never }
    )

    expect(result).toMatchObject({ created: false, subscribed: true })
    expect(mocks.consumeCaseImageUploads).toHaveBeenCalledWith(5, [
      'case/5/1-a.avif'
    ])
    expect(createdMessages()).toEqual([
      expect.objectContaining({
        case_id: 42,
        author_id: 5,
        kind: 'report',
        body: '第 3 分卷校验失败，重新下载也一样',
        images: {
          create: [{ storage_key: 'case/5/1-a.avif', sort: 0 }]
        }
      })
    ])
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
    expect(mocks.restoreCaseImageUploads).not.toHaveBeenCalled()
  })

  it('treats the opener resubmitting as a supplement that follows the reply rows', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status: 'waiting_reporter' })
    )

    await createCase(
      {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 100,
        content: '补充：解压到第二个文件夹时报错'
      },
      5,
      { now, db: mocks.tx as never }
    )

    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 42, status: 'waiting_reporter', revision: 3 },
      data: { status: 'waiting_owner' }
    })
    expect(createdMessages()[0]).toMatchObject({ kind: 'reply', author_id: 5 })
    expect(noticeRows()).toEqual([
      expect.objectContaining({ recipient_id: 2, link: '/issue/42' })
    ])
  })

  it('routes the interim link-failure kind to the publisher with a daily key', async () => {
    // No open case, no report today, then the freshly inserted row.
    mocks.tx.ops_case.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(
        caseRow({ kind: 'resource_link_failure', dedup_key: 'x' })
      )

    await createCase(
      {
        kind: 'resource_link_failure',
        targetType: 'resource',
        targetId: 100,
        content: '百度网盘那条显示分享已取消'
      },
      5,
      { now, db: mocks.tx as never }
    )

    const inserted = mocks.tx.ops_case.createMany.mock.calls[0][0].data[0]
    expect(inserted).toMatchObject({
      kind: 'resource_link_failure',
      owner_type: 'publisher',
      owner_id: 2,
      public: true,
      dedup_key: 'resource:100:resource_link_failure',
      daily_key: '5:resource:100:2026-09-26'
    })
  })

  it('makes the publisher explain「无法复现」and link a guide for「不在受理范围」', async () => {
    await expect(
      resolveCase(
        { caseId: 42, resolution: 'unreproducible', content: '' },
        2,
        {
          now,
          db: mocks.tx as never
        }
      )
    ).resolves.toBe('以「无法复现」结案时请写明核对了什么')
    await expect(
      resolveCase(
        { caseId: 42, resolution: 'out_of_scope', content: '这是网络问题' },
        2,
        { now, db: mocks.tx as never }
      )
    ).resolves.toContain('指南中的一篇链接')

    const closed = await resolveCase(
      {
        caseId: 42,
        resolution: 'out_of_scope',
        content: CASE_QUICK_REPLIES.find(({ code }) => code === 'out_of_scope')!
          .content
      },
      2,
      { now, db: mocks.tx as never }
    )
    expect(closed).toMatchObject({ changed: true })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'resolved',
      resolution: 'out_of_scope',
      dedup_key: null
    })
  })

  it('retires hide and ignore on a handed-off description case (D13)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        owner_type: 'staff',
        owner_id: null,
        escalated_at: hoursAgo(2)
      })
    )

    await expect(
      handleCaseAsAdmin(
        {
          caseId: 42,
          action: 'resolve',
          resolution: 'escalated_ignored',
          content: ''
        },
        90,
        3,
        { now, db: mocks.tx as never }
      )
    ).resolves.toBe('当前问题不支持该结论')
    await expect(
      handleCaseResource({ caseId: 42, action: 'hide', content: '' }, 90, 3, {
        now,
        db: mocks.tx as never
      })
    ).resolves.toBe('当前问题不能隐藏资源')

    const repaired = await handleCaseAsAdmin(
      { caseId: 42, action: 'resolve', resolution: 'repaired', content: '' },
      90,
      3,
      { now, db: mocks.tx as never }
    )
    expect(repaired).toMatchObject({ changed: true })
  })

  it('lets site feedback close out of scope with an explanation instead of a guide', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        kind: 'other',
        target_type: 'site',
        target_id: 0,
        patch_id: null,
        owner_type: 'staff',
        owner_id: null,
        public: false
      })
    )
    const handle = (content: string) =>
      handleCaseAsAdmin(
        { caseId: 42, action: 'resolve', resolution: 'out_of_scope', content },
        90,
        3,
        { now, db: mocks.tx as never }
      )

    await expect(handle('')).resolves.toBe('以「不在受理范围」结案时请写明理由')
    await expect(handle('改名需要在个人设置里自助完成')).resolves.toMatchObject(
      { changed: true }
    )
  })

  it('closes a sole withdrawal as「开启者撤回」and spares the withdrawer the notice', async () => {
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    const result = await withdrawCase(42, 5, { now, db: mocks.tx as never })

    expect(result).toMatchObject({ changed: true })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'resolved',
      resolution: 'reporter_withdrawn'
    })
    expect(createdMessages()[0]).toMatchObject({
      kind: 'system',
      event: 'resolved',
      payload: expect.objectContaining({ actor_type: 'reporter' })
    })
    expect(noticeRows().map((row) => row.recipient_id)).not.toContain(5)
    expect(noticeRows().map((row) => row.recipient_id)).toContain(2)
  })

  it('hands the case to the earliest remaining reporter on withdrawal (D33)', async () => {
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    mocks.tx.ops_case_subscriber.findFirst.mockResolvedValue({ user_id: 10 })

    await withdrawCase(42, 5, { now, db: mocks.tx as never })

    expect(mocks.tx.ops_case_subscriber.findFirst).toHaveBeenCalledWith({
      where: { case_id: 42, user_id: { not: 5 } },
      orderBy: [{ created: 'asc' }, { user_id: 'asc' }],
      select: { user_id: true }
    })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 42, reporter_id: 5, status: 'open', revision: 3 },
      data: { reporter_id: 10, updated: now }
    })
    expect(mocks.tx.ops_case_subscriber.deleteMany).toHaveBeenCalledWith({
      where: { case_id: 42, user_id: 5 }
    })
    expect(createdMessages()[0]).toMatchObject({
      event: 'withdrawn',
      payload: { actor_type: 'reporter', successor_id: 10 }
    })
    const notices = noticeRows()
    expect(notices.map((row) => row.recipient_id)).toEqual([10])
    expect(String(notices[0].content)).toContain('改由你作为报告者跟进')
  })

  it('restarts the reporter clock for a successor who owes an answer (D33)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status: 'waiting_reporter', status_changed_at: hoursAgo(13 * 24) })
    )
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    mocks.tx.ops_case_subscriber.findFirst.mockResolvedValue({ user_id: 10 })

    await withdrawCase(42, 5, { now, db: mocks.tx as never })

    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toEqual({
      reporter_id: 10,
      status_changed_at: now,
      revision: { increment: 1 },
      updated: now
    })
  })

  it('refuses a second withdrawal and stops offering it once the opener left', async () => {
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue(null)

    await expect(
      withdrawCase(42, 5, { now, db: mocks.tx as never })
    ).resolves.toBe('你已经撤回过这条问题')
    expect(mocks.tx.ops_case_message.create).not.toHaveBeenCalled()

    const detail = await getCase(42, 5, 1, { db: mocks.tx as never })
    expect(
      typeof detail === 'string' ? detail : detail.case.capabilities
    ).toMatchObject({ canWithdraw: false })
  })

  it('hands a twice-closed publisher case to the site administrator on review', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        status: 'resolved',
        resolution: 'unreproducible',
        closed_at: hoursAgo(3),
        reopened_count: 1
      })
    )
    mocks.tx.ops_case_message.findFirst.mockResolvedValue({
      payload: { actor_type: 'publisher' }
    })

    const result = await reviewCase(42, 5, '发布者没看截图就结案了', {
      now,
      db: mocks.tx as never
    })

    expect(result).toMatchObject({ changed: true })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 42, owner_type: 'publisher', reopened_count: 1 },
      data: {
        status: 'open',
        owner_type: 'staff',
        owner_id: null,
        escalated_at: now,
        reopened_count: { increment: 1 }
      }
    })
    const events = createdMessages()
    expect(events.map((message) => message.event ?? message.kind)).toEqual([
      'reopened',
      'escalated',
      'reply'
    ])
    expect(events[1].payload).toMatchObject({
      escalation_trigger: 'review_request',
      from_owner_id: 2
    })
    const recipients = noticeRows().map((row) => row.recipient_id)
    expect(recipients).toEqual(expect.arrayContaining([90, 91, 2]))
    // The publisher reads the reason in the dialogue, so the notice carries it too.
    expect(
      noticeRows().find((row) => row.recipient_id === 2)?.content
    ).toContain('申请网站管理员复核：发布者没看截图就结案了')
  })

  it('refuses a review when the latest closure did not come from the publisher', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status: 'resolved', closed_at: hoursAgo(3), reopened_count: 1 })
    )
    mocks.tx.ops_case_message.findFirst.mockResolvedValue({
      payload: { actor_type: 'system' }
    })

    await expect(
      reviewCase(42, 5, '不认可', { now, db: mocks.tx as never })
    ).resolves.toBe('只有发布者给出的结论可以申请复核')
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
  })

  it('records one closure confirmation per round', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        status: 'resolved',
        resolution: 'repaired',
        closed_at: hoursAgo(1)
      })
    )
    mocks.tx.ops_case_message.findMany.mockResolvedValueOnce([
      {
        kind: 'system',
        event: 'resolved',
        payload: { actor_type: 'publisher' }
      }
    ])

    await expect(
      confirmCase(42, 5, false, { now, db: mocks.tx as never })
    ).resolves.toMatchObject({ changed: true })
    expect(createdMessages()[0]).toMatchObject({
      event: 'confirmed',
      payload: expect.objectContaining({
        solved: false,
        resolution: 'repaired'
      })
    })

    mocks.tx.ops_case_message.findMany.mockResolvedValueOnce([
      {
        kind: 'system',
        event: 'resolved',
        payload: { actor_type: 'publisher' }
      },
      { kind: 'system', event: 'confirmed', payload: { solved: false } }
    ])
    await expect(
      confirmCase(42, 5, true, { now, db: mocks.tx as never })
    ).resolves.toBe('你已经确认过这次处理结果')
  })

  it('lets only the original publisher propose a closure on a handed-off case', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        owner_type: 'staff',
        owner_id: null,
        escalated_at: hoursAgo(2)
      })
    )

    await expect(
      proposeCaseClosure(
        { caseId: 42, resolution: 'repaired', content: '已重新上传第 3 分卷' },
        9,
        1,
        { now, db: mocks.tx as never }
      )
    ).resolves.toBe('只有原发布者可以提请结案')

    const result = await proposeCaseClosure(
      { caseId: 42, resolution: 'repaired', content: '已重新上传第 3 分卷' },
      2,
      1,
      { now, db: mocks.tx as never }
    )
    expect(result).toMatchObject({ changed: true })
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    // The note is written first so it sorts right before its event.
    expect(createdMessages()[0]).toMatchObject({
      kind: 'reply',
      author_id: 2,
      body: '已重新上传第 3 分卷'
    })
    expect(createdMessages()[1]).toMatchObject({
      event: 'close_proposed',
      payload: { resolution: 'repaired' }
    })
    expect(noticeRows().map((row) => row.link)).toEqual([
      '/dashboard/case/42',
      '/dashboard/case/42'
    ])
  })

  it('offers confirm and review to the opener only where the round allows it', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status: 'resolved', closed_at: hoursAgo(3), reopened_count: 1 })
    )
    mocks.tx.ops_case_message.findMany.mockResolvedValue([
      {
        kind: 'system',
        event: 'resolved',
        payload: { actor_type: 'publisher' }
      }
    ])

    const detail = await getCase(42, 5, 1, { db: mocks.tx as never })
    if (typeof detail === 'string') throw new Error(detail)

    expect(detail.case.capabilities).toMatchObject({
      canConfirm: true,
      canReview: true,
      canReopen: false,
      canWithdraw: false
    })
    // Opening the case reads the viewer's notices for it (D22).
    expect(mocks.tx.user_message.updateMany).toHaveBeenCalledWith({
      where: { recipient_id: 5, status: 0, link: '/issue/42' },
      data: { status: 1 }
    })
    // D15: the publisher-side dialogue carries real signatures now.
    const publisherView = await getCase(42, 2, 1, { db: mocks.tx as never })
    if (typeof publisherView === 'string') throw new Error(publisherView)
    expect(publisherView.case.reporter).toMatchObject({ id: 5 })
  })

  it('reminds once in the last 48 hours before the publisher deadline', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status_changed_at: hoursAgo(6 * 24) })
    )
    await expect(
      remindCase(42, { now, db: mocks.tx as never })
    ).resolves.toEqual({ changed: true })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 42, revision: 3 },
      data: { reminded_revision: 3 }
    })
    expect(noticeRows()[0]).toMatchObject({ recipient_id: 2 })
    expect(String(noticeRows()[0].content)).toContain('还有 2 天')

    vi.clearAllMocks()
    mocks.tx.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mocks.tx)
    )
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status_changed_at: hoursAgo(6 * 24), reminded_revision: 3 })
    )
    await expect(
      remindCase(42, { now, db: mocks.tx as never })
    ).resolves.toEqual({ changed: false })

    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status_changed_at: hoursAgo(2 * 24) })
    )
    await expect(
      remindCase(42, { now, db: mocks.tx as never })
    ).resolves.toEqual({ changed: false })
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
  })

  it('tells followers why a quiet first reporter ended the case', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        status: 'waiting_reporter',
        status_changed_at: hoursAgo(15 * 24)
      })
    )
    mocks.tx.ops_case_subscriber.findMany.mockResolvedValue([
      { user_id: 5 },
      { user_id: 8 }
    ])

    await timeoutCloseCase(42, { now, db: mocks.tx as never })

    const rows = noticeRows()
    const follower = rows.find((row) => row.recipient_id === 8)
    const opener = rows.find((row) => row.recipient_id === 5)
    expect(String(follower?.content)).toContain('首位报告者没有补充材料')
    expect(String(opener?.content)).toContain('开启者未回应')
  })

  it('returns one public badge per open case kind on a resource', async () => {
    mocks.tx.ops_case.findMany.mockResolvedValue([
      {
        target_id: 100,
        kind: 'resource_mismatch',
        owner_type: 'publisher',
        _count: { subscribers: 2 }
      },
      {
        target_id: 100,
        kind: 'resource_link_failure',
        owner_type: 'staff',
        _count: { subscribers: 1 }
      }
    ])

    const badges = await getPublicResourceCaseBadges([100], {
      db: mocks.tx as never
    })

    expect(badges.get(100)).toEqual([
      { kind: 'resource_mismatch', reportCount: 2, ownerType: 'publisher' },
      { kind: 'resource_link_failure', reportCount: 1, ownerType: 'staff' }
    ])
  })

  it('puts a guide link into every guide quick reply (D12)', () => {
    const byCode = Object.fromEntries(
      CASE_QUICK_REPLIES.map((reply) => [reply.code, reply.content])
    )
    expect(byCode.download_guide).toContain(CASE_GUIDE_LINKS.download)
    expect(byCode.archive_guide).toContain(CASE_GUIDE_LINKS.repairRar)
    expect(byCode.contribute_guide).toContain(CASE_GUIDE_LINKS.contribute)
    expect(CASE_QUICK_REPLIES.map((reply) => reply.label)).not.toContain(
      '请参考指南'
    )
  })
})

describe('site administrator review fixes (M03-8)', () => {
  const db = () => mocks.tx as never
  const staffCase = (overrides: Record<string, unknown> = {}) =>
    caseRow({
      kind: 'other',
      target_type: 'patch',
      target_id: 7,
      owner_type: 'staff',
      owner_id: null,
      public: false,
      dedup_key: 'patch:7:other:5',
      ...overrides
    })
  const adminReply = (content: string, extra: Record<string, unknown> = {}) =>
    handleCaseAsAdmin(
      { caseId: 42, action: 'reply', content, ...extra },
      90,
      3,
      { now, db: db() }
    )
  const recipients = () => noticeRows().map((row) => row.recipient_id)

  it('lets the administrator record「开启者未回应」only after 14 days on the reporter (D24)', async () => {
    const unresponsive = () =>
      handleCaseAsAdmin(
        {
          caseId: 42,
          action: 'resolve',
          resolution: 'reporter_unresponsive',
          content: ''
        },
        90,
        3,
        { now, db: db() }
      )
    const refused = '只有等待报告者满 14 天的站方事项可以登记「开启者未回应」'

    mocks.tx.ops_case.findUnique.mockResolvedValue(
      staffCase({
        status: 'waiting_reporter',
        status_changed_at: hoursAgo(13 * 24)
      })
    )
    await expect(unresponsive()).resolves.toBe(refused)
    // A publisher case keeps the conclusion for the timeout task.
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        status: 'waiting_reporter',
        status_changed_at: hoursAgo(15 * 24)
      })
    )
    await expect(unresponsive()).resolves.toBe(refused)
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()

    mocks.tx.ops_case.findUnique.mockResolvedValue(
      staffCase({
        status: 'waiting_reporter',
        status_changed_at: hoursAgo(15 * 24)
      })
    )
    mocks.tx.ops_case_subscriber.findMany.mockResolvedValue([
      { user_id: 5 },
      { user_id: 8 }
    ])
    await expect(unresponsive()).resolves.toMatchObject({ changed: true })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: { in: ['waiting_reporter'] } },
      data: { status: 'resolved', resolution: 'reporter_unresponsive' }
    })
    expect(createdMessages()[0].payload).toMatchObject({
      actor_type: 'staff',
      resolution: 'reporter_unresponsive'
    })
    const follower = noticeRows().find((row) => row.recipient_id === 8)
    expect(String(follower?.content)).toContain('首位报告者没有补充材料')
  })

  it('offers「开启者未回应」to the administrator once the staff case is due (D24)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    try {
      mocks.tx.ops_case.findUnique.mockResolvedValue(
        staffCase({
          status: 'waiting_reporter',
          status_changed_at: hoursAgo(15 * 24)
        })
      )
      const due = await getCase(42, 90, 3, { db: db() })
      if (typeof due === 'string') throw new Error(due)
      expect(due.case.capabilities.allowedResolutions).toEqual([
        'handled',
        'out_of_scope',
        'declined',
        'reporter_unresponsive'
      ])

      mocks.tx.ops_case.findUnique.mockResolvedValue(
        staffCase({
          status: 'waiting_reporter',
          status_changed_at: hoursAgo(13 * 24)
        })
      )
      const early = await getCase(42, 90, 3, { db: db() })
      if (typeof early === 'string') throw new Error(early)
      expect(early.case.capabilities.allowedResolutions).not.toContain(
        'reporter_unresponsive'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('declines a suggestion with a reason instead of a guide and logs the closure (D25, item 24)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      staffCase({ kind: 'patch_info', dedup_key: 'patch:7:patch_info:5' })
    )
    const decline = (content: string) =>
      handleCaseAsAdmin(
        { caseId: 42, action: 'reject', resolution: 'declined', content },
        90,
        3,
        { now, db: db() }
      )

    await expect(decline('')).resolves.toBe('以「不采纳」结案时请写明理由')
    await expect(
      decline('发售日期以官网为准，暂不修改')
    ).resolves.toMatchObject({ changed: true })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'rejected',
      resolution: 'declined'
    })
    expect(mocks.tx.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'case_close', user_id: 90 })
    })
    // The closer gets no notice about their own closure (item 22).
    expect(recipients()).toContain(5)
    expect(recipients()).not.toContain(90)
    expect(recipients()).toContain(91)

    // Sent through the resolve action it is still a rejection.
    await handleCaseAsAdmin(
      {
        caseId: 42,
        action: 'resolve',
        resolution: 'declined',
        content: '发售日期以官网为准，暂不修改'
      },
      90,
      3,
      { now, db: db() }
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[1][0].data).toMatchObject({
      status: 'rejected',
      resolution: 'declined'
    })
  })

  it('spares a closing publisher their own notice and writes no admin log (item 22)', async () => {
    await resolveCase({ caseId: 42, resolution: 'repaired', content: '' }, 2, {
      now,
      db: db()
    })
    expect(recipients()).toContain(5)
    expect(recipients()).not.toContain(2)
    expect(mocks.tx.admin_log.create).not.toHaveBeenCalled()
  })

  it('refuses images on a closing note (D30)', async () => {
    await expect(
      handleCaseAsAdmin(
        {
          caseId: 42,
          action: 'resolve',
          resolution: 'repaired',
          content: '已修正',
          imageKeys: ['case/90/1-a.avif']
        },
        90,
        3,
        { now, db: db() }
      )
    ).resolves.toBe('结案说明不能附图，需要配图请先发一条带图回复')
    expect(mocks.tx.$transaction).not.toHaveBeenCalled()
  })

  it('opens other feedback on a game per opener (D26)', async () => {
    mocks.tx.ops_case.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(staffCase())

    await createCase(
      {
        kind: 'other',
        targetType: 'patch',
        targetId: 7,
        content: '简介里少了一段剧情介绍'
      },
      5,
      { now, db: db() }
    )

    expect(mocks.tx.ops_case.findUnique.mock.calls[0][0]).toMatchObject({
      where: { dedup_key: 'patch:7:other:5' }
    })
    expect(mocks.tx.ops_case.createMany.mock.calls[0][0].data[0]).toMatchObject(
      { dedup_key: 'patch:7:other:5', daily_key: null, owner_type: 'staff' }
    )
  })

  it('sends administrator reply images and hands the case to the reporter by default (item 9)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(staffCase())

    await adminReply('请看截图里的位置', { imageKeys: ['case/90/1-a.avif'] })

    expect(mocks.consumeCaseImageUploads).toHaveBeenCalledWith(90, [
      'case/90/1-a.avif'
    ])
    expect(createdMessages()[0]).toMatchObject({
      kind: 'reply',
      author_id: 90,
      images: { create: [{ storage_key: 'case/90/1-a.avif', sort: 0 }] }
    })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'waiting_reporter'
    })
    // Administrators are never capped (D29).
    expect(mocks.checkCaseRateLimit).not.toHaveBeenCalled()
  })

  it('keeps the turn and the queue place when the administrator does not hand over (D28)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      staffCase({ status: 'waiting_owner' })
    )

    await adminReply('收到，稍后处理', { awaitReporter: false })

    const update = mocks.tx.ops_case.updateMany.mock.calls[0][0]
    expect(update.data).not.toHaveProperty('status')
    expect(update.data).not.toHaveProperty('status_changed_at')
    expect(update.data).not.toHaveProperty('revision')
    expect(update.data).toMatchObject({ first_owner_response_at: now })
    expect(noticeRows()).toEqual([
      expect.objectContaining({ recipient_id: 5, sender_id: 90 })
    ])
  })

  it('never lets a publisher keep the turn (D28)', async () => {
    await appendCaseMessage(
      { caseId: 42, content: '已更新链接，请再试', awaitReporter: false },
      2,
      1,
      { now, db: db() }
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'waiting_reporter'
    })
  })

  it('tells the publisher about an administrator reply before the handoff (item 19)', async () => {
    await adminReply('请发布者核对一下第 3 分卷')

    expect(recipients().sort()).toEqual([2, 5])
    expect(noticeRows().every((row) => row.link === '/issue/42')).toBe(true)
  })

  it('keeps the original publisher in the loop after a handoff (item 19)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        owner_type: 'staff',
        owner_id: null,
        escalated_at: hoursAgo(2)
      })
    )

    await adminReply('请原发布者确认是否已重新上传')
    expect(recipients().sort()).toEqual([2, 5])

    mocks.tx.user_message.createMany.mockClear()
    await appendCaseMessage({ caseId: 42, content: '还是打不开' }, 5, 1, {
      now,
      db: db()
    })
    expect(noticeRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipient_id: 90,
          link: '/dashboard/case/42'
        }),
        expect.objectContaining({ recipient_id: 2, link: '/issue/42' })
      ])
    )
    expect(recipients()).not.toContain(5)
  })

  it('caps non-administrator replies per case before any database work (D29)', async () => {
    mocks.checkCaseRateLimit.mockResolvedValueOnce(
      '回复过于频繁，请 120 秒后再试'
    )

    await expect(
      appendCaseMessage(
        {
          caseId: 42,
          content: '还是打不开',
          imageKeys: ['case/5/1-a.avif']
        },
        5,
        1,
        { now, db: db() }
      )
    ).resolves.toBe('回复过于频繁，请 120 秒后再试')
    expect(mocks.checkCaseRateLimit).toHaveBeenCalledWith('message', 5, 42)
    expect(mocks.consumeCaseImageUploads).not.toHaveBeenCalled()
    expect(mocks.tx.$transaction).not.toHaveBeenCalled()
  })

  it('counts the opener resubmission toward the same cap and rolls it back (D29)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status: 'waiting_reporter' })
    )
    mocks.checkCaseRateLimit.mockResolvedValueOnce(
      '回复过于频繁，请 60 秒后再试'
    )

    const result = await createCase(
      {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 100,
        content: '补充：第二个分卷也校验失败',
        imageKeys: ['case/5/1-a.avif']
      },
      5,
      { now, db: db(), role: 1 }
    )

    expect(result).toBe('回复过于频繁，请 60 秒后再试')
    expect(mocks.checkCaseRateLimit).toHaveBeenCalledWith('message', 5, 42)
    expect(createdMessages()).toEqual([])
    expect(mocks.restoreCaseImageUploads).toHaveBeenCalledWith(5, [
      'case/5/1-a.avif'
    ])
  })

  it('does not cap later-reporter notes or administrator resubmissions (D29)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(caseRow({ reporter_id: 8 }))
    await createCase(
      {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 100,
        content: '我这边也是第 3 分卷坏了'
      },
      5,
      { now, db: db(), role: 1 }
    )
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ status: 'waiting_reporter' })
    )
    await createCase(
      {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 100,
        content: '补充：第二个分卷也校验失败'
      },
      5,
      { now, db: db(), role: 3 }
    )
    expect(mocks.checkCaseRateLimit).not.toHaveBeenCalled()
  })

  it('hides and unhides a note without touching the case (D27)', async () => {
    const hide = (hidden: boolean, role = 3) =>
      setCaseMessageHidden({ caseId: 42, messageId: 61, hidden }, 90, role, {
        now,
        db: db()
      })

    await expect(hide(true, 2)).resolves.toBe('本页面仅管理员可访问')

    mocks.tx.ops_case_message.findFirst.mockResolvedValueOnce({
      id: 61,
      kind: 'reply',
      payload: null
    })
    await expect(hide(true)).resolves.toMatchObject({ changed: true })
    expect(mocks.tx.ops_case_message.updateMany).toHaveBeenCalledWith({
      where: { id: 61, case_id: 42, payload: { equals: Prisma.AnyNull } },
      data: { payload: { hidden_at: now.toISOString() } }
    })
    expect(mocks.tx.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'case_message_hide', user_id: 90 })
    })
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()

    // Repeating the request is a no-op.
    mocks.tx.ops_case_message.findFirst.mockResolvedValueOnce({
      id: 61,
      kind: 'reply',
      payload: { hidden_at: now.toISOString() }
    })
    await expect(hide(true)).resolves.toMatchObject({ changed: false })
    expect(mocks.tx.ops_case_message.updateMany).toHaveBeenCalledTimes(1)

    // Unhiding clears the flag it just read.
    mocks.tx.ops_case_message.findFirst.mockResolvedValueOnce({
      id: 61,
      kind: 'report',
      payload: { hidden_at: '2026-09-26T07:00:00.000Z' }
    })
    await expect(hide(false)).resolves.toMatchObject({ changed: true })
    expect(mocks.tx.ops_case_message.updateMany.mock.calls[1][0]).toEqual({
      where: {
        id: 61,
        case_id: 42,
        payload: { path: ['hidden_at'], equals: '2026-09-26T07:00:00.000Z' }
      },
      data: { payload: Prisma.DbNull }
    })

    mocks.tx.ops_case_message.findFirst.mockResolvedValueOnce({
      id: 61,
      kind: 'system',
      payload: { resolution: 'repaired' }
    })
    await expect(hide(true)).resolves.toBe('系统消息不能隐藏')
  })

  it('serves a hidden note as a placeholder to everyone but the administrator (D27)', async () => {
    mocks.tx.ops_case_message.findMany.mockResolvedValue([
      {
        id: 61,
        kind: 'reply',
        event: null,
        payload: { hidden_at: '2026-09-26T07:00:00.000Z' },
        body: '骚扰内容',
        created: hoursAgo(1),
        author: { id: 5, name: '报告者', avatar: '', role: 1 },
        images: [{ storage_key: 'case/5/1-a.avif' }]
      }
    ])

    const publisherView = await getCase(42, 2, 1, { db: db() })
    if (typeof publisherView === 'string') throw new Error(publisherView)
    expect(publisherView.case.messages[0]).toMatchObject({
      body: '该内容已被网站管理员隐藏。',
      hidden: true
    })
    expect(publisherView.case.messages[0]).not.toHaveProperty('images')
    expect(publisherView.case.messages[0]).not.toHaveProperty('payload')

    const adminView = await getCase(42, 90, 3, { db: db() })
    if (typeof adminView === 'string') throw new Error(adminView)
    expect(adminView.case.messages[0]).toMatchObject({
      body: '骚扰内容',
      hidden: true,
      images: ['https://img.example/case/5/1-a.avif']
    })
    expect(adminView.case.capabilities.canHideMessages).toBe(true)
    expect(publisherView.case.capabilities.canHideMessages).toBe(false)
  })

  it('shows the administrator what was reported, and nobody else (item 3)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        kind: 'content_violation',
        target_type: 'comment',
        target_id: 300,
        owner_type: 'staff',
        owner_id: null,
        public: false
      })
    )
    mocks.tx.patch_comment.findUnique.mockResolvedValue({
      id: 300,
      content: '<p>加群<strong>领资源</strong></p>',
      user: { id: 12, name: '评论者', avatar: '' }
    })

    const adminView = await getCase(42, 90, 3, { db: db() })
    if (typeof adminView === 'string') throw new Error(adminView)
    expect(adminView.case.target.content).toEqual({
      text: '加群领资源',
      author: { id: 12, name: '评论者', avatar: '' }
    })

    const reporterView = await getCase(42, 5, 1, { db: db() })
    if (typeof reporterView === 'string') throw new Error(reporterView)
    expect(reporterView.case.target).not.toHaveProperty('content')
  })

  it('lists the other open suggestions on the same game for the administrator (item 7)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      staffCase({ kind: 'patch_info', dedup_key: 'patch:7:patch_info:5' })
    )
    mocks.tx.ops_case.findMany.mockResolvedValue([{ id: 43 }, { id: 45 }])

    const adminView = await getCase(42, 90, 3, { db: db() })
    if (typeof adminView === 'string') throw new Error(adminView)
    expect(adminView.case.relatedOpenCaseIds).toEqual([43, 45])
    expect(mocks.tx.ops_case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: 42 },
          kind: 'patch_info',
          target_type: 'patch',
          target_id: 7,
          status: { in: ['open', 'waiting_reporter', 'waiting_owner'] }
        }
      })
    )

    const reporterView = await getCase(42, 5, 1, { db: db() })
    if (typeof reporterView === 'string') throw new Error(reporterView)
    expect(reporterView.case).not.toHaveProperty('relatedOpenCaseIds')
  })

  it('logs a comment deleted through a case besides the closure (item 24)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        kind: 'content_violation',
        target_type: 'comment',
        target_id: 300,
        owner_type: 'staff',
        owner_id: null,
        public: false
      })
    )
    mocks.tx.patch_comment.findUnique.mockResolvedValue({
      id: 300,
      patch_id: 7,
      content: '<p>广告</p>',
      user: { id: 12, name: '评论者', avatar: '' }
    })

    await expect(
      handleCaseContent(
        { caseId: 42, action: 'delete', content: '广告' },
        90,
        3,
        {
          now,
          db: db()
        }
      )
    ).resolves.toMatchObject({ changed: true, action: 'delete' })
    expect(
      mocks.tx.admin_log.create.mock.calls.map(([args]) => args.data.type)
    ).toEqual(['case_content_delete', 'case_close'])
  })

  const shoutboxCase = () =>
    caseRow({
      kind: 'content_violation',
      target_type: 'shoutbox',
      target_id: 10,
      owner_type: 'staff',
      owner_id: null,
      public: false
    })

  const shoutboxRow = (status: number) => ({
    id: 10,
    status,
    content: '10000000000000000000',
    user: { id: 6, name: '创作者', avatar: '' }
  })

  it('records a misjudgement restore as rejected, like every 不成立', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(shoutboxCase())
    mocks.tx.shoutbox.findUnique.mockResolvedValue(shoutboxRow(2))
    mocks.restoreShoutboxForCase.mockResolvedValue(true)

    await expect(
      handleCaseContent({ caseId: 42, action: 'restore', content: '' }, 90, 3, {
        now,
        db: db()
      })
    ).resolves.toMatchObject({ changed: true, action: 'restore' })
    expect(mocks.restoreShoutboxForCase).toHaveBeenCalledWith(
      mocks.tx,
      10,
      90,
      42,
      now
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'rejected',
      resolution: 'not_established'
    })
  })

  it('rejects a restore whose shoutbox is already gone, and resolves a takedown', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(shoutboxCase())
    mocks.tx.shoutbox.findUnique.mockResolvedValue(null)
    await handleCaseContent(
      { caseId: 42, action: 'restore', content: '' },
      90,
      3,
      { now, db: db() }
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'rejected',
      resolution: 'not_established'
    })

    mocks.tx.shoutbox.findUnique.mockResolvedValue(shoutboxRow(0))
    mocks.removeShoutboxForCase.mockResolvedValue(true)
    await handleCaseContent(
      { caseId: 42, action: 'takedown', content: '' },
      90,
      3,
      { now, db: db() }
    )
    // The shoutbox log names the case that carried the takedown.
    expect(mocks.removeShoutboxForCase).toHaveBeenCalledWith(
      mocks.tx,
      10,
      90,
      42,
      now
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[1][0].data).toMatchObject({
      status: 'resolved',
      resolution: 'handled'
    })
  })
})

describe('manual test review fixes (M03-9)', () => {
  const db = () => mocks.tx as never
  const reply = (id: number, author: { id: number; role: number }) => ({
    id,
    kind: 'reply',
    event: null,
    payload: null,
    body: `回复 ${id}`,
    created: now,
    author: { ...author, name: `用户 ${author.id}`, avatar: '' },
    images: []
  })

  it('keeps other reporters away from a violation report opener (D31)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({
        kind: 'content_violation',
        target_type: 'comment',
        target_id: 300,
        owner_type: 'staff',
        owner_id: null,
        public: false,
        dedup_key: 'comment:300:content_violation',
        _count: { subscribers: 3 }
      })
    )
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    mocks.tx.patch_comment.findUnique.mockResolvedValue({
      id: 300,
      patch_id: 7,
      content: '<p>被举报的评论</p>',
      user: { id: 12, name: '评论者', avatar: '' }
    })

    const detail = await getCase(42, 5, 1, { db: db() })
    if (typeof detail === 'string') throw new Error(detail)
    expect(detail.case.subscriberCount).toBeNull()
    expect(mocks.tx.ops_case_message.findMany.mock.calls[0][0].where).toEqual({
      case_id: 42,
      OR: [
        { author_id: 5 },
        { kind: 'reply', author: { is: { role: { gte: 3 } } } },
        {
          kind: 'system',
          OR: [{ event: null }, { event: { not: 'withdrawn' } }]
        }
      ]
    })
  })

  it('still shows a resource opener every reporter and the count (D15)', async () => {
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })

    const detail = await getCase(42, 5, 1, { db: db() })
    if (typeof detail === 'string') throw new Error(detail)
    expect(detail.case.subscriberCount).toBe(1)
    expect(mocks.tx.ops_case_message.findMany.mock.calls[0][0].where).toEqual({
      case_id: 42
    })
  })

  it('leaves the first response to the publisher when an administrator steps in (D32)', async () => {
    await handleCaseAsAdmin(
      { caseId: 42, action: 'reply', content: '站方先看一下', awaitReporter: false },
      90,
      3,
      { now, db: db() }
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'first_owner_response_at'
    )

    await appendCaseMessage(
      { caseId: 42, content: '已经在核对文件了' },
      2,
      1,
      { now, db: db() }
    )
    expect(mocks.tx.ops_case.updateMany.mock.calls[1][0].data).toMatchObject({
      first_owner_response_at: now
    })
  })

  it('signs administrator and original publisher replies by their side', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ owner_type: 'staff', owner_id: null, escalated_at: hoursAgo(2) })
    )
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    mocks.tx.ops_case_message.findMany.mockResolvedValue([
      reply(1, { id: 90, role: 4 }),
      reply(2, { id: 2, role: 2 }),
      reply(3, { id: 5, role: 1 })
    ])

    const detail = await getCase(42, 5, 1, { db: db() })
    if (typeof detail === 'string') throw new Error(detail)
    expect(detail.case.messages.map((message) => message.authorSide)).toEqual([
      'staff',
      'original-publisher',
      undefined
    ])
  })

  it('marks the owning publisher and leaves a handed-over opener unmarked (D33)', async () => {
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    mocks.tx.ops_case_message.findMany.mockResolvedValue([
      reply(1, { id: 11, role: 1 }),
      reply(2, { id: 2, role: 1 }),
      reply(3, { id: 5, role: 1 })
    ])

    const detail = await getCase(42, 5, 1, { db: db() })
    if (typeof detail === 'string') throw new Error(detail)
    // 11 opened the case and withdrew; 5 took it over.
    expect(detail.case.messages.map((message) => message.authorSide)).toEqual([
      undefined,
      'publisher',
      undefined
    ])
  })

  it('names the original publisher from the handoff once the resource is gone', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ owner_type: 'staff', owner_id: null, escalated_at: hoursAgo(2) })
    )
    mocks.tx.patch_resource.findUnique.mockResolvedValue(null)
    mocks.tx.ops_case_subscriber.findUnique.mockResolvedValue({ user_id: 5 })
    mocks.tx.ops_case_message.findMany.mockResolvedValue([
      {
        id: 1,
        kind: 'system',
        event: 'escalated',
        payload: { escalation_trigger: 'timeout', from_owner_id: 2 },
        body: '发布者 7 天未处理，问题已提交给网站管理员处理。',
        created: now,
        author: null,
        images: []
      },
      reply(2, { id: 2, role: 1 })
    ])

    const detail = await getCase(42, 5, 1, { db: db() })
    if (typeof detail === 'string') throw new Error(detail)
    expect(detail.case.messages[1].authorSide).toBe('original-publisher')
  })
})

describe('original publisher closing a timeout handoff (D36)', () => {
  const db = () => mocks.tx as never
  const handedOff = (overrides: Record<string, unknown> = {}) =>
    caseRow({
      owner_type: 'staff',
      owner_id: null,
      escalated_at: hoursAgo(2),
      ...overrides
    })
  type Trigger = 'timeout' | 'review_request'
  // The detail read derives the trigger from the dialogue it loads.
  const dialogue = (trigger: Trigger) =>
    mocks.tx.ops_case_message.findMany.mockResolvedValue([
      {
        id: 70,
        kind: 'system',
        event: 'escalated',
        payload: { escalation_trigger: trigger },
        body: '问题已提交给网站管理员处理。',
        created: hoursAgo(2),
        author: null,
        images: []
      }
    ])
  // The resolve and propose routes read the latest handoff in their transaction.
  const lastHandoff = (trigger: Trigger) =>
    mocks.tx.ops_case_message.findFirst.mockResolvedValue({
      payload: { escalation_trigger: trigger }
    })
  const capabilitiesOf = async (uid: number) => {
    const detail = await getCase(42, uid, 1, { db: db() })
    if (typeof detail === 'string') throw new Error(detail)
    return detail.case.capabilities
  }
  const resolve = (resolution: string, content = '', uid = 2) =>
    resolveCase({ caseId: 42, resolution: resolution as never, content }, uid, {
      now,
      db: db()
    })
  const propose = () =>
    proposeCaseClosure(
      { caseId: 42, resolution: 'repaired', content: '已重新上传第 3 分卷' },
      2,
      1,
      { now, db: db() }
    )
  const onlyPropose = '该问题只能提请结案，由网站管理员确认后结案'

  it('lets the original publisher close a timeout handoff as the publisher', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(handedOff())
    dialogue('timeout')
    expect(await capabilitiesOf(2)).toMatchObject({
      canReply: true,
      canResolve: true,
      canPropose: false,
      allowedResolutions: ['repaired', 'unreproducible', 'out_of_scope']
    })

    lastHandoff('timeout')
    mocks.tx.ops_case_subscriber.findMany.mockResolvedValue([
      { user_id: 5 },
      { user_id: 8 }
    ])
    await expect(
      resolve('repaired', '已重新上传第 3 分卷')
    ).resolves.toMatchObject({ changed: true })
    expect(mocks.tx.ops_case_message.findFirst).toHaveBeenCalledWith({
      where: { case_id: 42, kind: 'system', event: 'escalated' },
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      select: { payload: true }
    })
    expect(mocks.tx.ops_case.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 42, revision: 3 },
      data: { status: 'resolved', resolution: 'repaired', dedup_key: null }
    })
    expect(createdMessages()[0]).toMatchObject({
      kind: 'system',
      event: 'resolved',
      payload: expect.objectContaining({
        actor_type: 'publisher',
        resolution: 'repaired'
      })
    })
    // A publisher closure: no processed item for the site administrators and
    // no notice to them; reporter and followers hear, the closer does not.
    expect(mocks.tx.admin_log.create).not.toHaveBeenCalled()
    expect(noticeRows().map((row) => row.recipient_id)).toEqual([5, 8])
  })

  it('holds the original publisher to the publisher closing rules (D12, D16)', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(handedOff())
    lastHandoff('timeout')

    await expect(resolve('unreproducible')).resolves.toBe(
      '以「无法复现」结案时请写明核对了什么'
    )
    await expect(resolve('out_of_scope', '这是网络问题')).resolves.toContain(
      '指南中的一篇链接'
    )
    await expect(resolve('escalated_ignored')).resolves.toBe(
      '发布者不能使用该结论'
    )
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
  })

  it('leaves nothing to propose where the original publisher may close', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(handedOff())
    lastHandoff('timeout')

    await expect(propose()).resolves.toBe('该问题可以直接结案，无需提请')
    expect(mocks.tx.ops_case_message.create).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
  })

  it('keeps a review handoff with the site administrator (D16, D20)', async () => {
    // Without a reopen count in the way, the trigger alone decides.
    mocks.tx.ops_case.findUnique.mockResolvedValue(handedOff())
    dialogue('review_request')
    expect(await capabilitiesOf(2)).toMatchObject({
      canResolve: false,
      canPropose: true,
      allowedResolutions: []
    })

    lastHandoff('review_request')
    await expect(resolve('repaired', '已重新上传')).resolves.toBe(onlyPropose)
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    await expect(propose()).resolves.toMatchObject({ changed: true })
  })

  it('keeps a reopened timeout handoff with the site administrator', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      handedOff({ reopened_count: 1 })
    )
    dialogue('timeout')
    expect(await capabilitiesOf(2)).toMatchObject({
      canResolve: false,
      canPropose: true
    })

    lastHandoff('timeout')
    await expect(resolve('repaired', '已重新上传')).resolves.toBe(onlyPropose)
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
  })

  it('refuses anyone but the original publisher', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(handedOff())
    dialogue('timeout')
    expect(await capabilitiesOf(5)).toMatchObject({
      canResolve: false,
      canPropose: false
    })

    lastHandoff('timeout')
    await expect(resolve('repaired', '', 9)).resolves.toBe(
      '只有当前资源发布者可以结案'
    )
    await expect(resolve('repaired', '', 5)).resolves.toBe(
      '只有当前资源发布者可以结案'
    )
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
  })

  it('keeps the case with the site administrator once the reporter reopens it', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      handedOff({
        status: 'resolved',
        resolution: 'repaired',
        closed_at: hoursAgo(3),
        dedup_key: null
      })
    )

    await expect(
      reopenCase(42, 5, '第 3 分卷还是打不开', { now, db: db() })
    ).resolves.toMatchObject({ changed: true })
    const update = mocks.tx.ops_case.updateMany.mock.calls[0][0]
    expect(update.data).toMatchObject({
      status: 'open',
      reopened_count: { increment: 1 }
    })
    expect(update.data).not.toHaveProperty('owner_type')
    expect(update.data).not.toHaveProperty('owner_id')
    // The reason reaches the original publisher too, as the reporter's replies
    // on a handed-off case do (review item 19).
    expect(noticeRows()).toEqual([
      expect.objectContaining({ recipient_id: 90, link: '/dashboard/case/42' }),
      expect.objectContaining({ recipient_id: 91, link: '/dashboard/case/42' }),
      expect.objectContaining({ recipient_id: 2, link: '/issue/42' })
    ])

    // From here on the original publisher only proposes.
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      handedOff({ reopened_count: 1, resolution: 'repaired' })
    )
    dialogue('timeout')
    expect(await capabilitiesOf(2)).toMatchObject({
      canResolve: false,
      canPropose: true
    })

    // The case no longer belongs to the publisher, so no review follows.
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      handedOff({
        status: 'resolved',
        resolution: 'repaired',
        closed_at: hoursAgo(1),
        reopened_count: 1
      })
    )
    await expect(
      reviewCase(42, 5, '还是打不开', { now, db: db() })
    ).resolves.toBe('发布者在重新打开后再次结案，才能申请网站管理员复核')
  })
})
