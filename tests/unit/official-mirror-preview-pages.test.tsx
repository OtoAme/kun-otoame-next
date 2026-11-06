import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  patch_resource: { findMany: vi.fn() }
}))
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  previewResourceMerge: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({
  getPublicResourceCaseBadges: vi.fn(async () => new Map())
}))
vi.mock('~/lib/dashboard/auth', () => ({ requireDashboardUser: mocks.auth }))
vi.mock('~/lib/officialMirror/mergeService', () => ({
  previewResourceMerge: mocks.previewResourceMerge
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  }
}))
vi.mock('~/components/patch/resource/ResourceDownload', () => ({
  ResourceDownload: () => null
}))
vi.mock('~/components/patch/resource/ResourceInfo', () => ({
  ResourceInfo: () => null
}))

import ResourceCardPage, {
  dynamic as cardDynamic,
  metadata as cardMetadata
} from '~/app/(preview)/preview/resource-card/[id]/page'
import ResourceMergePage, {
  dynamic as mergeDynamic,
  metadata as mergeMetadata
} from '~/app/(preview)/preview/resource-merge/page'
import { isAdminPreviewPath } from '~/constants/routes/matcher'

type CardElement = Awaited<ReturnType<typeof ResourceCardPage>>

const link = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  version: 1,
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
  size: '2 GB',
  sort_order: 0,
  download: 0,
  ...overrides
})

const row = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Resource ${id}`,
  section: 'galgame',
  type: ['pc'],
  language: ['ja'],
  platform: ['windows'],
  note: '',
  download: 1,
  status: 0,
  user_id: 7,
  patch_id: 1,
  created: new Date('2026-10-09T00:00:00.000Z'),
  publisher_left_at: null,
  patch: { unique_id: 'abcdefgh' },
  user: {
    id: 7,
    name: 'Author',
    avatar: '',
    role: 1,
    _count: { patch_resource: 2 }
  },
  _count: { like_by: 6 },
  links: [link(id + 1)],
  ...overrides
})

/** Props of ResourceInfo and ResourceDownload inside Card > CardBody. */
const cardChildren = (element: CardElement) =>
  [element.props.children.props.children].flat() as {
    props: Record<string, unknown> & { resource: Record<string, unknown> }
  }[]

const expectNoCredentials = (element: CardElement) => {
  const json = JSON.stringify(cardChildren(element).map((child) => child.props))
  expect(json).not.toContain('private-code')
  expect(json).not.toContain('private-password')
  for (const child of cardChildren(element)) {
    for (const item of child.props.resource.links as object[]) {
      expect(item).not.toHaveProperty('code')
      expect(item).not.toHaveProperty('password')
    }
  }
}

const cardPage = (id: string) =>
  ResourceCardPage({ params: Promise.resolve({ id }) })
const mergePage = (query: Record<string, string | string[] | undefined>) =>
  ResourceMergePage({ searchParams: Promise.resolve(query) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ id: 1, name: '管理员', role: 3 })
  db.$queryRaw.mockResolvedValue([])
  db.patch_resource.findMany.mockResolvedValue([row(2)])
})

describe('resource card and merge preview pages', () => {
  it('render dynamically and stay out of search indexes', () => {
    expect(cardDynamic).toBe('force-dynamic')
    expect(mergeDynamic).toBe('force-dynamic')
    for (const metadata of [cardMetadata, mergeMetadata]) {
      expect(metadata.robots).toEqual({ index: false, follow: false })
    }
  })

  it('authorizes before reading any card', async () => {
    mocks.auth.mockRejectedValue(new Error('unauthorized'))
    await expect(cardPage('2')).rejects.toThrow('unauthorized')
    await expect(mergePage({ user: '2', staff: '9' })).rejects.toThrow(
      'unauthorized'
    )
    expect(db.patch_resource.findMany).not.toHaveBeenCalled()
    expect(mocks.previewResourceMerge).not.toHaveBeenCalled()
  })

  it.each([0, 1, 2])('hides both pages from role %s', async (role) => {
    mocks.auth.mockResolvedValue({ id: 5, name: '用户', role })
    await expect(cardPage('2')).rejects.toThrow('not-found')
    await expect(mergePage({ user: '2', staff: '9' })).rejects.toThrow(
      'not-found'
    )
    expect(db.patch_resource.findMany).not.toHaveBeenCalled()
    expect(mocks.previewResourceMerge).not.toHaveBeenCalled()
  })

  it.each(['7x', '0', '07', '12345678'])(
    'rejects the card id %s without querying',
    async (id) => {
      await expect(cardPage(id)).rejects.toThrow('not-found')
      expect(db.patch_resource.findMany).not.toHaveBeenCalled()
    }
  )

  it('renders a hidden card for administrators without credentials', async () => {
    db.patch_resource.findMany.mockResolvedValue([row(2, { status: 1 })])

    const element = await cardPage('2')

    expect(db.patch_resource.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [2] }
    })
    const [info, download] = cardChildren(element)
    expect(info.props).toEqual({ resource: download.props.resource })
    expect(download.props.preview).toBe(true)
    expect(download.props.resource).toMatchObject({
      id: 2,
      status: 1,
      likeCount: 6,
      isLike: false,
      links: [{ id: 3, content: 'https://pan.quark.cn/s/link3' }]
    })
    expectNoCredentials(element)
  })

  it('hides a missing card', async () => {
    db.patch_resource.findMany.mockResolvedValue([])
    await expect(cardPage('404')).rejects.toThrow('not-found')
  })

  it.each([
    {},
    { user: '2' },
    { staff: '9' },
    { user: '2', staff: '2' },
    { user: ['2', '3'], staff: '9' },
    { user: 'abc', staff: '9' },
    { user: '2', staff: '-9' }
  ])('rejects the merge query %j without querying', async (query) => {
    await expect(mergePage(query)).rejects.toThrow('not-found')
    expect(mocks.previewResourceMerge).not.toHaveBeenCalled()
    expect(db.patch_resource.findMany).not.toHaveBeenCalled()
  })

  it('hides the survivor when the merge preview returns an error', async () => {
    mocks.previewResourceMerge.mockResolvedValue('资源不存在')
    await expect(mergePage({ user: '2', staff: '9' })).rejects.toThrow(
      'not-found'
    )
  })

  it('renders the survivor as one public card in the merge preview order', async () => {
    db.patch_resource.findMany.mockResolvedValue([
      row(2, { links: [link(3)] }),
      row(9, {
        status: 1,
        user_id: 1,
        download: 5,
        _count: { like_by: 40 },
        user: {
          id: 1,
          name: 'Staff',
          avatar: '',
          role: 3,
          _count: { patch_resource: 900 }
        },
        links: [
          link(10, {
            storage: 'touchgal',
            content: 'https://touchgal.example.test/file10',
            attached_at: new Date('2026-11-02T00:00:00.000Z')
          })
        ]
      })
    ])
    mocks.previewResourceMerge.mockResolvedValue({
      survivorPreview: {
        name: 'Resource 2',
        type: ['pc'],
        language: ['ja', 'zh-Hans'],
        platform: ['windows'],
        note: '合并后的备注',
        noteAppended: true,
        links: [
          { id: 3, storage: 'user', sortOrder: 0 },
          { id: 10, storage: 'touchgal', sortOrder: 1 }
        ]
      }
    })

    const element = await mergePage({ user: '2', staff: '9' })

    expect(mocks.previewResourceMerge).toHaveBeenCalledWith({
      userResourceId: 2,
      staffResourceId: 9
    })
    const [info, download] = cardChildren(element)
    expect(info.props).toEqual({ resource: download.props.resource })
    expect(download.props.preview).toBe(true)
    expect(download.props.resource).toMatchObject({
      id: 2,
      status: 0,
      name: 'Resource 2',
      language: ['ja', 'zh-Hans'],
      note: '合并后的备注',
      likeCount: 6,
      download: 6,
      user: { id: 7, name: 'Author' },
      hasStaffBackup: true,
      backedUpAt: '2026-11-02T00:00:00.000Z',
      links: [
        { id: 3, sortOrder: 0, content: 'https://pan.quark.cn/s/link3' },
        {
          id: 10,
          sortOrder: 1,
          ownerType: 'staff',
          content: 'https://touchgal.example.test/file10'
        }
      ]
    })
    expectNoCredentials(element)
  })
})

describe('admin preview URLs', () => {
  it.each([
    ['/preview/resource-card/12', true],
    ['/preview/resource-card/12/', true],
    ['/preview/resource-merge', true],
    ['/preview/resource-merge/', true],
    ['/preview/resource/34', true],
    ['/preview/submission/12', true],
    ['/preview/resource-card', false],
    ['/preview/resource-merge/12', false],
    ['/preview/resource-cards/12', false],
    ['/preview/resource-card/12/edit', false]
  ])('treats %s as an admin preview: %s', (pathname, expected) => {
    expect(isAdminPreviewPath(pathname)).toBe(expected)
  })
})
