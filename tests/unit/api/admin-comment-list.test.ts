import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_comment: { findMany: vi.fn(), count: vi.fn() }
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

import { getComment } from '~/app/api/admin/comment/get'

const row = (id: number, content: string) => ({
  id,
  content,
  patch_id: 1,
  created: new Date('2026-10-28T00:00:00.000Z'),
  patch: { name: '夏空カナタ', unique_id: 'aaaa1111' },
  user: { id: 5, name: 'momo', avatar: '' },
  _count: { like_by: 0 }
})

beforeEach(() => {
  vi.resetAllMocks()
  prismaMocks.patch_comment.count.mockResolvedValue(2)
})

describe('admin comment list', () => {
  it('cuts long comments to an excerpt and marks only those as truncated', async () => {
    prismaMocks.patch_comment.findMany.mockResolvedValue([
      row(1, '短评论'),
      row(2, '长'.repeat(240))
    ])

    const { comments } = await getComment({
      page: 1,
      limit: 30,
      searchType: 'content'
    } as Parameters<typeof getComment>[0])

    expect(comments[0]).toMatchObject({ content: '短评论', truncated: false })
    expect(comments[1].truncated).toBe(true)
    expect(comments[1].content).toHaveLength(233)
  })

  it('does not mark a comment of exactly the excerpt length', async () => {
    prismaMocks.patch_comment.findMany.mockResolvedValue([
      row(3, '字'.repeat(233))
    ])

    const { comments } = await getComment({
      page: 1,
      limit: 30,
      searchType: 'content'
    } as Parameters<typeof getComment>[0])

    expect(comments[0].truncated).toBe(false)
  })
})
