import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const prismaMocks = vi.hoisted(() => ({
  patch_resource: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

import {
  buildAdminResourceWhere,
  getPatchResource
} from '~/app/api/admin/resource/get'
import { adminResourcePaginationSchema } from '~/validations/admin'

const parse = (query: Record<string, string>) =>
  adminResourcePaginationSchema.parse({ page: '1', limit: '30', ...query })
const where = (query: Record<string, string>, nsfw = {}) =>
  buildAdminResourceWhere(parse(query), nsfw)
    .AND as Prisma.patch_resourceWhereInput[]

const linkSearch = (value: string) => ({
  OR: [
    { links: { some: { content: { contains: value, mode: 'insensitive' } } } },
    { links: { some: { hash: { contains: value, mode: 'insensitive' } } } }
  ]
})

describe('admin resource list service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch_resource.findMany.mockResolvedValue([])
    prismaMocks.patch_resource.count.mockResolvedValue(0)
  })

  it('searches resource links by content or BLAKE3 hash when no field is given', async () => {
    await getPatchResource(
      { page: 1, limit: 30, search: 'abc-hash', userId: undefined },
      {}
    )
    const call = prismaMocks.patch_resource.findMany.mock.calls[0][0]
    expect(call.where.AND).toContainEqual(linkSearch('abc-hash'))
    expect(call.orderBy).toEqual([{ created: 'desc' }, { id: 'desc' }])
    expect(prismaMocks.patch_resource.count).toHaveBeenCalledWith({
      where: call.where
    })
  })

  it('adds exact resource identity while retaining the existing patch preference', async () => {
    await getPatchResource(
      { page: 1, limit: 1, search: '', resourceId: 17, userId: undefined },
      { content_limit: 'sfw' },
      { uid: 9, role: 3 }
    )
    expect(prismaMocks.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 17 }, { patch: { content_limit: 'sfw' } }] },
        take: 1,
        skip: 0
      })
    )
  })

  it('keeps the old query unchanged for callers that send no new filter', () => {
    expect(
      where({ search: 'x', userId: '5' }, { content_limit: 'sfw' })
    ).toEqual([
      linkSearch('x'),
      { user_id: 5 },
      { patch: { content_limit: 'sfw' } }
    ])
  })

  it('searches name, note, game name and id by default, never links', () => {
    const [search] = where({ search: '42', searchField: 'all' })
    expect(search).toEqual({
      OR: [
        { name: { contains: '42', mode: 'insensitive' } },
        { note: { contains: '42', mode: 'insensitive' } },
        { patch: { name: { contains: '42', mode: 'insensitive' } } },
        { id: 42 }
      ]
    })
    expect(JSON.stringify(search)).not.toContain('links')
    const [text] = where({ search: '补丁', searchField: 'all' })
    expect(JSON.stringify(text)).not.toContain('"id"')
  })

  it.each([
    [
      'text',
      { OR: [{ name: expect.anything() }, { note: expect.anything() }] }
    ],
    ['game', { patch: { name: { contains: 'abc', mode: 'insensitive' } } }],
    ['link', linkSearch('abc')],
    ['id', { id: -1 }]
  ])('limits the search to the %s field', (searchField, expected) => {
    expect(where({ search: 'abc', searchField })[0]).toEqual(expected)
  })

  it('combines every filter with AND and multi-values with OR', () => {
    expect(
      where({
        section: 'galgame',
        status: '1,2',
        publisher: 'official',
        type: 'pc,official-zh',
        language: 'ja',
        platform: 'windows,psp',
        health: 'broken',
        from: '2026-10-01',
        to: '2026-10-29',
        rating: 'all'
      })
    ).toEqual([
      { section: 'galgame' },
      { status: { in: [1, 2] } },
      { user: { role: { gte: 3 } } },
      { type: { hasSome: ['pc', 'official-zh'] } },
      { language: { hasSome: ['ja'] } },
      { platform: { hasSome: ['windows', 'psp'] } },
      { links: { some: { health: 'broken' } } },
      { created: { gte: new Date('2026-09-30T16:00:00.000Z') } },
      { created: { lt: new Date('2026-10-29T16:00:00.000Z') } },
      { patch: {} }
    ])
  })

  it.each([
    ['user', { user: { role: { lt: 3 } } }],
    [
      'attention',
      { links: { some: { health: { in: ['suspect', 'disputed'] } } } }
    ],
    ['healthy', { links: { some: {}, every: { health: 'ok' } } }]
  ])('maps %s to its condition', (value, expected) => {
    const key = value === 'user' ? 'publisher' : 'health'
    expect(where({ [key]: value })).toContainEqual(expected)
  })

  it('lets an explicit rating replace the viewer display setting', () => {
    const nsfw = { content_limit: 'sfw' }
    expect(where({}, nsfw)).toEqual([{ patch: nsfw }])
    expect(where({ rating: 'all' }, nsfw)).toEqual([{ patch: {} }])
    expect(where({ rating: 'nsfw' }, nsfw)).toEqual([
      { patch: { content_limit: 'nsfw' } }
    ])
  })

  it.each([
    ['download_desc', [{ download: 'desc' }, { id: 'desc' }]],
    ['created_asc', [{ created: 'asc' }, { id: 'asc' }]]
  ])('sorts by %s with a stable tie-breaker', async (sort, orderBy) => {
    await getPatchResource(parse({ sort }), {})
    expect(
      prismaMocks.patch_resource.findMany.mock.calls[0][0].orderBy
    ).toEqual(orderBy)
  })

  it.each([
    { status: '3' },
    { status: '' },
    { type: 'pc,unknown' },
    { section: 'other' },
    { health: 'gone' },
    { publisher: 'admin' },
    { rating: 'r18' },
    { sort: 'name' },
    { searchField: 'note' },
    { from: '2026-02-30' },
    { from: '2026-10-29', to: '2026-10-01' }
  ])('rejects invalid filter %o instead of ignoring it', (query) => {
    expect(
      adminResourcePaginationSchema.safeParse({
        page: '1',
        limit: '30',
        ...query
      }).success
    ).toBe(false)
  })
})
