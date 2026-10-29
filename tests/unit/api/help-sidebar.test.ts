import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  help_post: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))

import { getHelpSidebar, listHelpPosts } from '~/app/api/help/service'
import { HELP_SIDEBAR_ITEM_LIMIT } from '~/constants/help'

beforeEach(() => {
  vi.clearAllMocks()
  db.help_post.groupBy.mockResolvedValue([
    { category: 'runtime', _count: { _all: 4 } },
    { category: 'unknown', _count: { _all: 9 } }
  ])
  db.help_post.count.mockResolvedValue(4)
  db.help_post.findMany.mockResolvedValue([])
})

const listInput = (scope: 'all' | 'mine' | 'followed') => ({
  page: 1,
  limit: 20,
  sort: 'latest' as const,
  scope
})

describe('help sidebar', () => {
  it('counts every public post when no status is chosen', async () => {
    const result = await getHelpSidebar(null, {})

    expect(db.help_post.groupBy.mock.calls[0][0].where).not.toHaveProperty(
      'AND'
    )
    expect(result.categoryCounts).toMatchObject({ runtime: 4, request: 0 })
    expect(result).toMatchObject({ total: 4, mine: null, followed: null })
  })

  it('narrows counts to the status tab but not the own lists', async () => {
    await getHelpSidebar({ uid: 7, role: 1 }, {}, { status: 'open' })

    expect(db.help_post.groupBy.mock.calls[0][0].where.AND[1]).toEqual({
      status: 'open'
    })
    for (const [args] of db.help_post.findMany.mock.calls) {
      expect(args.where).not.toHaveProperty('status')
      expect(args.where).not.toHaveProperty('AND')
    }
  })

  it('shows a few own and followed posts with their full totals', async () => {
    db.help_post.count
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(5)
    db.help_post.findMany.mockResolvedValue([
      { id: 1, title: 't', status: 'open' }
    ])

    const result = await getHelpSidebar({ uid: 7, role: 1 }, {})

    for (const [args] of db.help_post.findMany.mock.calls) {
      expect(args.take).toBe(HELP_SIDEBAR_ITEM_LIMIT)
    }
    expect(result.mine).toEqual({
      items: [{ id: 1, title: 't', status: 'open' }],
      total: 12
    })
    expect(result.followed?.total).toBe(5)
  })
})

describe('help list scopes', () => {
  it('lists the reader’s own posts including hidden ones', async () => {
    await listHelpPosts(listInput('mine'), {}, { viewer: { uid: 7, role: 1 } })

    expect(db.help_post.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      user_id: 7,
      deleted_at: null
    })
  })

  it('lists followed posts under the public rules', async () => {
    await listHelpPosts(
      listInput('followed'),
      {},
      {
        viewer: { uid: 7, role: 1 }
      }
    )

    expect(db.help_post.findMany.mock.calls[0][0].where.AND[0]).toMatchObject({
      deleted_at: null,
      hidden_at: null,
      follows: { some: { user_id: 7 } }
    })
  })

  it('returns nothing for own scopes without a reader', async () => {
    await listHelpPosts(listInput('mine'), {}, { viewer: null })

    expect(db.help_post.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      id: { in: [] }
    })
  })
})
