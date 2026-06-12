import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_tag: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const invalidateTagCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateTagCaches: invalidateTagCachesMock
}))

import { createTag } from '~/app/api/tag/create'
import { updateTag } from '~/app/api/tag/update'

describe('tag writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch_tag.findFirst.mockResolvedValue(null)
    prismaMocks.patch_tag.create.mockResolvedValue({
      id: 1,
      name: '恋爱',
      count: 0,
      alias: ['純愛']
    })
    prismaMocks.patch_tag.update.mockResolvedValue({
      id: 1,
      name: '恋爱',
      count: 0,
      alias: ['純愛'],
      user: {
        id: 100,
        name: 'admin',
        avatar: ''
      }
    })
    invalidateTagCachesMock.mockResolvedValue(undefined)
  })

  it('rejects a new tag alias already used by another tag alias', async () => {
    prismaMocks.patch_tag.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 2, name: '纯爱', alias: ['純愛'] })

    const result = await createTag(
      {
        name: '恋爱',
        introduction: '',
        alias: ['純愛']
      },
      100
    )

    expect(result).toBe('这个标签别名已经被其它标签使用了')
    expect(prismaMocks.patch_tag.create).not.toHaveBeenCalled()
    expect(invalidateTagCachesMock).not.toHaveBeenCalled()
  })

  it('rejects an updated tag alias already used as another tag name', async () => {
    prismaMocks.patch_tag.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 2, name: '純愛', alias: [] })

    const result = await updateTag({
      tagId: 1,
      name: '恋爱',
      introduction: '',
      alias: ['純愛']
    })

    expect(result).toBe('这个标签别名已经被其它标签使用了')
    expect(prismaMocks.patch_tag.update).not.toHaveBeenCalled()
    expect(invalidateTagCachesMock).not.toHaveBeenCalled()
  })

  it('allows updating a tag while keeping its own aliases', async () => {
    prismaMocks.patch_tag.findFirst
      .mockResolvedValueOnce({ id: 1, name: '恋爱', alias: ['純愛'] })
      .mockResolvedValueOnce(null)

    const result = await updateTag({
      tagId: 1,
      name: '恋爱',
      introduction: '',
      alias: ['純愛']
    })

    expect(result).toMatchObject({
      id: 1,
      name: '恋爱',
      alias: ['純愛']
    })
    expect(prismaMocks.patch_tag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          name: '恋爱',
          alias: ['純愛']
        })
      })
    )
    expect(invalidateTagCachesMock).toHaveBeenCalledWith(1)
  })
})
