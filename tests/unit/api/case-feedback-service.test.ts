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
      findFirst: vi.fn()
    },
    ops_case_subscriber: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn()
    },
    patch_resource: { findUnique: vi.fn(), findMany: vi.fn() },
    patch: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    user_message: { createMany: vi.fn(), findMany: vi.fn() },
    admin_log: { create: vi.fn() }
  }
  return {
    tx,
    consumeCaseImageUploads: vi.fn(),
    restoreCaseImageUploads: vi.fn()
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

import {
  buildCaseDedupKey,
  confirmCase,
  createCase,
  getCase,
  getPublicResourceCaseBadges,
  handleCaseAsAdmin,
  handleCaseResource,
  proposeCaseClosure,
  remindCase,
  resolveCase,
  reviewCase,
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
  mocks.consumeCaseImageUploads.mockResolvedValue(null)
  mocks.restoreCaseImageUploads.mockResolvedValue(undefined)
})

describe('case feedback rules (M03-6, M03-7)', () => {
  it('gives each opener their own entry-suggestion and site-feedback case', () => {
    expect(buildCaseDedupKey('patch', 7, 'patch_info', 5)).toBe(
      'patch:7:patch_info:5'
    )
    expect(buildCaseDedupKey('site', 0, 'other', 5)).toBe('site:0:other:5')
    expect(buildCaseDedupKey('patch', 7, 'other', 5)).toBe('patch:7:other')
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
      resolveCase({ caseId: 42, resolution: 'unreproducible', content: '' }, 2, {
        now,
        db: mocks.tx as never
      })
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
      caseRow({ owner_type: 'staff', owner_id: null, escalated_at: hoursAgo(2) })
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
      handleCaseResource(
        { caseId: 42, action: 'hide', content: '' },
        90,
        3,
        { now, db: mocks.tx as never }
      )
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

    await expect(handle('')).resolves.toBe(
      '以「不在受理范围」结案时请写明理由'
    )
    await expect(handle('改名需要在个人设置里自助完成')).resolves.toMatchObject(
      { changed: true }
    )
  })

  it('closes a sole withdrawal as「开启者撤回」and spares the withdrawer the notice', async () => {
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

  it('only drops the opener when other reporters still follow the case', async () => {
    mocks.tx.ops_case_subscriber.count.mockResolvedValue(2)

    await withdrawCase(42, 5, { now, db: mocks.tx as never })

    expect(mocks.tx.ops_case_subscriber.deleteMany).toHaveBeenCalledWith({
      where: { case_id: 42, user_id: 5 }
    })
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    expect(createdMessages()[0]).toMatchObject({
      event: 'withdrawn',
      payload: { actor_type: 'reporter' }
    })
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
      caseRow({ status: 'resolved', resolution: 'repaired', closed_at: hoursAgo(1) })
    )
    mocks.tx.ops_case_message.findMany.mockResolvedValueOnce([
      { kind: 'system', event: 'resolved', payload: { actor_type: 'publisher' } }
    ])

    await expect(
      confirmCase(42, 5, false, { now, db: mocks.tx as never })
    ).resolves.toMatchObject({ changed: true })
    expect(createdMessages()[0]).toMatchObject({
      event: 'confirmed',
      payload: expect.objectContaining({ solved: false, resolution: 'repaired' })
    })

    mocks.tx.ops_case_message.findMany.mockResolvedValueOnce([
      { kind: 'system', event: 'resolved', payload: { actor_type: 'publisher' } },
      { kind: 'system', event: 'confirmed', payload: { solved: false } }
    ])
    await expect(
      confirmCase(42, 5, true, { now, db: mocks.tx as never })
    ).resolves.toBe('你已经确认过这次处理结果')
  })

  it('lets only the original publisher propose a closure on a handed-off case', async () => {
    mocks.tx.ops_case.findUnique.mockResolvedValue(
      caseRow({ owner_type: 'staff', owner_id: null, escalated_at: hoursAgo(2) })
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
    expect(createdMessages()[0]).toMatchObject({
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
      { kind: 'system', event: 'resolved', payload: { actor_type: 'publisher' } }
    ])

    const detail = await getCase(42, 5, 1, { db: mocks.tx as never })
    if (typeof detail === 'string') throw new Error(detail)

    expect(detail.case.capabilities).toMatchObject({
      canConfirm: true,
      canReview: true,
      canReopen: false,
      canWithdraw: false
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
      caseRow({ status: 'waiting_reporter', status_changed_at: hoursAgo(15 * 24) })
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
