import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  patch_resource: { findMany: vi.fn() },
  patch_resource_access_grant: { findMany: vi.fn() },
  patch_resource_access: { findMany: vi.fn() }
}))
const mocks = vi.hoisted(() => ({
  badges: vi.fn(),
  previewResourceMerge: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({
  getPublicResourceCaseBadges: mocks.badges
}))
vi.mock('~/lib/officialMirror/mergeService', () => ({
  previewResourceMerge: mocks.previewResourceMerge
}))

import { getPatchResource } from '~/app/api/patch/resource/get'
import {
  composeMergeSurvivorCard,
  loadMergeSurvivorCard,
  loadPreviewResourceCard,
  loadPreviewResourceCards,
  parseMergePreviewQuery,
  parsePreviewResourceId
} from '~/lib/officialMirror/previewCard'

const link = (
  id: number,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> => ({
  id,
  version: 2,
  evidence_round: 0,
  health: 'ok',
  health_changed_at: null,
  verified_at: null,
  content_changed_at: null,
  attached_at: null,
  reports: [],
  check: null,
  storage: 'user',
  content: `https://pan.quark.cn/s/link${id}`,
  code: 'private-code',
  password: 'private-password',
  hash: '',
  size: '1 GB',
  sort_order: 0,
  download: 0,
  ...overrides
})

const resource = (
  id: number,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> => ({
  id,
  name: `Resource ${id}`,
  section: 'galgame',
  type: ['pc'],
  language: ['ja'],
  platform: ['windows'],
  note: '',
  download: 3,
  status: 0,
  user_id: 7,
  patch_id: 1,
  created: new Date('2026-10-09T00:00:00.000Z'),
  publisher_left_at: null,
  patch: { unique_id: 'abcdefgh' },
  user: {
    id: 7,
    name: 'Author',
    avatar: 'https://image.example.test/a.webp',
    role: 1,
    _count: { patch_resource: 4 }
  },
  _count: { like_by: 5 },
  like_by: [],
  links: [link(id + 1)],
  ...overrides
})

const userRow = () =>
  resource(2, {
    links: [
      link(3),
      link(4, {
        sort_order: 1,
        health: 'broken',
        content: 'https://pan.baidu.com/s/1link4'
      })
    ]
  })

const staffRow = () =>
  resource(9, {
    name: 'Staff copy',
    user_id: 1,
    download: 4,
    created: new Date('2026-11-01T00:00:00.000Z'),
    user: {
      id: 1,
      name: 'Staff',
      avatar: '',
      role: 3,
      _count: { patch_resource: 900 }
    },
    _count: { like_by: 2 },
    links: [
      link(10, {
        storage: 'touchgal',
        content: 'https://touchgal.example.test/file10',
        attached_at: new Date('2026-11-02T00:00:00.000Z'),
        content_changed_at: new Date('2026-11-03T00:00:00.000Z')
      })
    ]
  })

const survivorPreview = (linkIds: { id: number; sortOrder: number }[]) => ({
  name: 'Resource 2',
  type: ['pc', 'patch'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '用户备注\n\n站方备份说明',
  noteAppended: true,
  links: linkIds.map(({ id, sortOrder }) => ({
    id,
    storage: id === 10 ? 'touchgal' : 'user',
    content: `https://view.example.test/${id}`,
    size: '1 GB',
    version: 2,
    sortOrder,
    changedAt: null,
    backedUpAt: null
  }))
})

beforeEach(() => {
  vi.clearAllMocks()
  db.$queryRaw.mockResolvedValue([])
  db.patch_resource.findMany.mockResolvedValue([resource(2)])
  db.patch_resource_access_grant.findMany.mockResolvedValue([])
  db.patch_resource_access.findMany.mockResolvedValue([])
  mocks.badges.mockResolvedValue(new Map())
})

describe('preview resource ids', () => {
  it.each([
    ['7', 7],
    ['9999999', 9999999],
    ['0', null],
    ['07', null],
    ['7x', null],
    [' 7', null],
    ['10000000', null],
    [['7'], null],
    [undefined, null]
  ])('parses %j as %j', (raw, expected) => {
    expect(parsePreviewResourceId(raw)).toBe(expected)
  })

  it('accepts one user and one different staff id only', () => {
    expect(parseMergePreviewQuery({ user: '2', staff: '9' })).toEqual({
      userResourceId: 2,
      staffResourceId: 9
    })
    for (const query of [
      {},
      { user: '2' },
      { staff: '9' },
      { user: '2', staff: '2' },
      { user: ['2', '3'], staff: '9' },
      { user: '2', staff: '9x' }
    ]) {
      expect(parseMergePreviewQuery(query)).toBeNull()
    }
  })
})

describe('preview card projection', () => {
  it('reads one card of any status and game visibility', async () => {
    db.patch_resource.findMany.mockResolvedValue([
      resource(2, {
        status: 1,
        publisher_left_at: new Date('2026-10-10T00:00:00.000Z')
      })
    ])

    const card = await loadPreviewResourceCard(2)

    expect(db.patch_resource.findMany).toHaveBeenCalledTimes(1)
    const query = db.patch_resource.findMany.mock.calls[0][0]
    expect(query.where).toEqual({ id: { in: [2] } })
    expect(query.include).not.toHaveProperty('like_by')
    expect(query.include.links.orderBy).toEqual({ sort_order: 'asc' })
    expect(card).toMatchObject({
      id: 2,
      status: 1,
      isLike: false,
      likeCount: 5,
      publisherLeftAt: '2026-10-10T00:00:00.000Z',
      user: { id: 7, name: 'Author', patchCount: 4, role: 1 }
    })
    expect(db.patch_resource_access_grant.findMany).not.toHaveBeenCalled()
    expect(db.patch_resource_access.findMany).not.toHaveBeenCalled()
  })

  it('keeps the link address but never the extraction or archive code', async () => {
    const card = await loadPreviewResourceCard(2)

    expect(card?.links[0]).toMatchObject({
      id: 3,
      content: 'https://pan.quark.cn/s/link3',
      diskKind: 'quark'
    })
    for (const item of card?.links ?? []) {
      expect(item).not.toHaveProperty('code')
      expect(item).not.toHaveProperty('password')
      expect(item).not.toHaveProperty('revealed')
      expect(item).not.toHaveProperty('obtained')
    }
    const json = JSON.stringify(card)
    expect(json).not.toContain('private-code')
    expect(json).not.toContain('private-password')
  })

  it('equals the anonymous public projection plus the link address', async () => {
    const row = resource(2, {
      publisher_left_at: new Date('2026-10-08T00:00:00.000Z'),
      links: [
        link(3, { health: 'suspect' }),
        link(4, {
          storage: 'touchgal',
          sort_order: 1,
          content: 'https://touchgal.example.test/file4',
          attached_at: new Date('2026-10-01T00:00:00.000Z'),
          content_changed_at: new Date('2026-10-02T00:00:00.000Z')
        })
      ]
    })
    db.patch_resource.findMany.mockResolvedValue([row])
    const [publicCard] = await getPatchResource({ patchId: 1 }, { uid: 0 })
    const card = await loadPreviewResourceCard(2)

    expect(card).toEqual({
      ...publicCard,
      links: publicCard.links.map(({ revealed: _revealed, ...rest }) => ({
        ...rest,
        content: (row.links as { id: number; content: string }[]).find(
          (item) => item.id === rest.id
        )?.content
      }))
    })
    expect(card).toMatchObject({
      hasStaffBackup: true,
      backedUpAt: '2026-10-02T00:00:00.000Z',
      links: [
        { id: 3, health: 'suspect', backedUpAt: null },
        { id: 4, ownerType: 'staff', backedUpAt: '2026-10-02T00:00:00.000Z' }
      ]
    })
  })

  it('returns no card for a missing id and skips the read for no ids', async () => {
    db.patch_resource.findMany.mockResolvedValue([])
    expect(await loadPreviewResourceCard(404)).toBeNull()
    db.patch_resource.findMany.mockClear()
    expect((await loadPreviewResourceCards([])).size).toBe(0)
    expect(db.patch_resource.findMany).not.toHaveBeenCalled()
  })
})

describe('merge survivor card', () => {
  beforeEach(() => {
    db.patch_resource.findMany.mockResolvedValue([staffRow(), userRow()])
  })

  it('composes the survivor from the merge preview and both card projections', async () => {
    mocks.previewResourceMerge.mockResolvedValue({
      survivorPreview: survivorPreview([
        { id: 3, sortOrder: 0 },
        { id: 4, sortOrder: 1 },
        { id: 10, sortOrder: 2 }
      ])
    })

    const card = await loadMergeSurvivorCard({
      userResourceId: 2,
      staffResourceId: 9
    })

    expect(mocks.previewResourceMerge).toHaveBeenCalledWith({
      userResourceId: 2,
      staffResourceId: 9
    })
    expect(db.patch_resource.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [2, 9] }
    })
    expect(card).toMatchObject({
      id: 2,
      name: 'Resource 2',
      type: ['pc', 'patch'],
      language: ['zh-Hans'],
      platform: ['windows'],
      note: '用户备注\n\n站方备份说明',
      userId: 7,
      likeCount: 5,
      download: 7,
      created: String(new Date('2026-10-09T00:00:00.000Z')),
      user: { id: 7, name: 'Author', patchCount: 4, role: 1 },
      hasStaffBackup: true,
      backedUpAt: '2026-11-03T00:00:00.000Z'
    })
    expect(card?.links.map((item) => [item.id, item.sortOrder])).toEqual([
      [3, 0],
      [4, 1],
      [10, 2]
    ])
    // Links keep the projection of their own card, not the preview view.
    expect(card?.links[1]).toMatchObject({
      health: 'broken',
      diskKind: 'baidu',
      content: 'https://pan.baidu.com/s/1link4'
    })
    expect(card?.links[2]).toMatchObject({
      storage: 'touchgal',
      ownerType: 'staff',
      content: 'https://touchgal.example.test/file10',
      backedUpAt: '2026-11-03T00:00:00.000Z'
    })
    const json = JSON.stringify(card)
    expect(json).not.toContain('private-code')
    expect(json).not.toContain('private-password')
  })

  it('follows the survivor link order rather than the card order', async () => {
    const cards = await loadPreviewResourceCards([2, 9])
    const card = composeMergeSurvivorCard(
      survivorPreview([
        { id: 10, sortOrder: 0 },
        { id: 4, sortOrder: 1 },
        { id: 3, sortOrder: 2 }
      ]),
      cards.get(2)!,
      cards.get(9)!
    )
    expect(card?.links.map((item) => item.id)).toEqual([10, 4, 3])
  })

  it('has no survivor when the preview fails, a card is gone or a link moved away', async () => {
    mocks.previewResourceMerge.mockResolvedValue('资源不存在')
    expect(
      await loadMergeSurvivorCard({ userResourceId: 2, staffResourceId: 9 })
    ).toBeNull()

    mocks.previewResourceMerge.mockResolvedValue({
      survivorPreview: survivorPreview([{ id: 3, sortOrder: 0 }])
    })
    db.patch_resource.findMany.mockResolvedValue([userRow()])
    expect(
      await loadMergeSurvivorCard({ userResourceId: 2, staffResourceId: 9 })
    ).toBeNull()

    db.patch_resource.findMany.mockResolvedValue([staffRow(), userRow()])
    mocks.previewResourceMerge.mockResolvedValue({
      survivorPreview: survivorPreview([
        { id: 3, sortOrder: 0 },
        { id: 99, sortOrder: 1 }
      ])
    })
    expect(
      await loadMergeSurvivorCard({ userResourceId: 2, staffResourceId: 9 })
    ).toBeNull()
  })
})
