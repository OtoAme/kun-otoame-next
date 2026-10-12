import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  patch_resource_link: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn()
  },
  ops_case: { findMany: vi.fn(), count: vi.fn() },
  patch_submission: { count: vi.fn() },
  patch_resource: { count: vi.fn() },
  user_message: { count: vi.fn() },
  patch_report: { count: vi.fn() },
  admin_log: { count: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({
  getAdminCaseInboxItems: vi.fn(),
  getAdminCaseInboxItem: vi.fn()
}))
import {
  getAdminInbox,
  getAdminInboxCounts,
  getAdminInboxItem
} from '~/app/api/admin/inbox/service'
import { listAdminLinks } from '~/app/api/patch/resource/link/read'
const now = new Date('2026-10-09T00:00:00Z')
const row = (id: number, name = 'repair') => ({
  id,
  resource_id: 7,
  storage: 'touchgal',
  size: '1 GB',
  hash: '',
  content: `https://example.test/private-${id}`,
  code: 'secret-code',
  password: 'secret-password',
  sort_order: 0,
  download: 0,
  version: 1,
  evidence_round: 0,
  health: 'broken',
  health_changed_at: new Date('2026-10-01T00:00:00Z'),
  verified_at: null,
  content_changed_at: null,
  reports: [],
  check: null,
  resource: {
    user_id: 2,
    patch_id: 3,
    name,
    section: 'galgame',
    links: [{ storage: 'touchgal' }, { storage: 'user' }],
    patch: { name: 'Game', unique_id: 'abcdefgh' }
  }
})
beforeEach(() => {
  vi.resetAllMocks()
  db.patch_resource_link.findMany.mockResolvedValue([row(1), row(2, 'needle')])
  db.ops_case.findMany.mockResolvedValue([])
  for (const model of [
    db.ops_case,
    db.patch_submission,
    db.patch_resource,
    db.user_message,
    db.patch_report,
    db.admin_log
  ])
    model.count.mockResolvedValue(0)
})
it('shares pending selection between item/list/count and searches before truncating', async () => {
  db.ops_case.findMany.mockResolvedValue([{ target_id: 1 }])
  const list = await getAdminInbox(
    {
      kinds: ['broken-link'],
      search: 'needle',
      order: 'waiting',
      limitPerKind: 1
    },
    now,
    { uid: 9, role: 3 }
  )
  expect(list.items.map((item) => item.id)).toEqual([2])
  expect(list.totals['broken-link']).toBe(1)
  expect((await getAdminInboxCounts(9, now)).pending['broken-link']).toBe(1)
  db.patch_resource_link.findUnique.mockResolvedValue(row(2))
  const item = await getAdminInboxItem({ kind: 'broken-link', id: 2 }, now, {
    uid: 9,
    role: 3
  })
  expect(item).toMatchObject({
    state: 'pending',
    item: { payload: { actions: { relink: true, remove: true } } }
  })
  const safe = JSON.stringify(item)
  for (const secret of ['private-2', 'secret-code', 'secret-password'])
    expect(safe).not.toContain(secret)
})
it('distinguishes missing from recovered or already-covered targets without inventing a broken payload', async () => {
  db.patch_resource_link.findUnique.mockResolvedValue(null)
  expect(await getAdminInboxItem({ kind: 'broken-link', id: 8 }, now)).toEqual({
    state: 'missing',
    item: null
  })
  db.patch_resource_link.findUnique.mockResolvedValue({
    ...row(1),
    health: 'ok'
  })
  db.patch_resource_link.findMany.mockResolvedValue([])
  expect(await getAdminInboxItem({ kind: 'broken-link', id: 1 }, now)).toEqual({
    state: 'processed',
    item: null
  })
  db.patch_resource_link.findUnique.mockResolvedValue(row(1))
  db.patch_resource_link.findMany.mockResolvedValue([row(1)])
  db.ops_case.findMany.mockResolvedValue([{ target_id: 1 }])
  expect(await getAdminInboxItem({ kind: 'broken-link', id: 1 }, now)).toEqual({
    state: 'processed',
    item: null
  })
})
it('keeps admin host denominator independent of filters and the unconfigured tracking time truthful', async () => {
  db.patch_resource_link.findMany
    .mockResolvedValueOnce([row(1)])
    .mockResolvedValueOnce([
      { content: 'https://example.test/a', health: 'broken' },
      { content: 'https://example.test/b', health: 'ok' }
    ])
  const result = await listAdminLinks(
    { page: 1, limit: 20, ownerType: 'staff' },
    { uid: 9, role: 3 }
  )
  expect(result.hosts).toEqual([
    { hostname: 'example.test', totalLinks: 2, brokenLinks: 1 }
  ])
  expect(result.trackingStartedAt).toBeNull()
  expect(result.items[0]).not.toHaveProperty('content')
})
it('returns an actual current-version link case ID with one batched lookup', async () => {
  db.patch_resource_link.findMany
    .mockResolvedValueOnce([row(1)])
    .mockResolvedValueOnce([])
  db.ops_case.findMany.mockResolvedValue([
    { id: 9, target_id: 1, dedup_key: 'link:1:v:1' },
    { id: 10, target_id: 1, dedup_key: 'link:1:v:0' }
  ])
  const result = await listAdminLinks(
    { page: 1, limit: 20 },
    { uid: 9, role: 3 }
  )
  expect(result.items[0].caseId).toBe(9)
  expect(db.ops_case.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        target_type: 'link',
        OR: [{ target_id: 1, dedup_key: 'link:1:v:1' }]
      })
    })
  )
})
