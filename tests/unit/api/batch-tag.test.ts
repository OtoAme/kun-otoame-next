import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_tag: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    patch_tag_relation: {
      createMany: vi.fn(),
      deleteMany: vi.fn()
    }
  }
  type MockTransaction = typeof tx

  return {
    patch_tag_relation: {
      findMany: vi.fn()
    },
    patch_tag: {
      findMany: vi.fn()
    },
    $transaction: vi.fn((fn: (transaction: MockTransaction) => Promise<void>) => fn(tx)),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const invalidateTagCachesMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/cache', () => ({
  invalidateTagCaches: invalidateTagCachesMock
}))

import { handleBatchPatchTags } from '~/app/api/edit/batchTag'

describe('handleBatchPatchTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$transaction.mockImplementation((fn: (tx: typeof prismaMocks._tx) => Promise<void>) =>
      fn(prismaMocks._tx)
    )
    prismaMocks._tx.patch_tag.createMany.mockResolvedValue({ count: 0 })
    prismaMocks._tx.patch_tag.findMany.mockResolvedValue([])
    prismaMocks._tx.patch_tag_relation.createMany.mockResolvedValue({ count: 0 })
    prismaMocks._tx.patch_tag_relation.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks._tx.patch_tag.updateMany.mockResolvedValue({ count: 0 })
    invalidateTagCachesMock.mockResolvedValue(undefined)
  })

  it('should map alias input to existing tag instead of creating duplicate tag', async () => {
    prismaMocks.patch_tag_relation.findMany.mockResolvedValue([])
    prismaMocks.patch_tag.findMany.mockResolvedValue([
      { id: 1, name: '纯爱', alias: ['純愛'], count: 3 }
    ])

    const result = await handleBatchPatchTags(10, ['純愛'], 100)

    expect(result).toEqual({ success: true })
    expect(prismaMocks._tx.patch_tag.createMany).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_tag_relation.createMany).toHaveBeenCalledWith({
      data: [{ patch_id: 10, tag_id: 1 }],
      skipDuplicates: true
    })
    expect(prismaMocks._tx.patch_tag.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { count: { increment: 1 } }
    })
    expect(invalidateTagCachesMock).toHaveBeenCalledOnce()
  })

  it('should keep existing relation when submitted tag matches alias', async () => {
    prismaMocks.patch_tag_relation.findMany.mockResolvedValue([
      {
        tag_id: 1,
        tag: { id: 1, name: '纯爱', alias: ['純愛'], count: 3 }
      }
    ])
    prismaMocks.patch_tag.findMany.mockResolvedValue([])

    await handleBatchPatchTags(10, ['純愛'], 100)

    expect(prismaMocks.patch_tag.findMany).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_tag_relation.createMany).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_tag_relation.deleteMany).not.toHaveBeenCalled()
    expect(prismaMocks._tx.patch_tag.updateMany).not.toHaveBeenCalled()
    expect(invalidateTagCachesMock).toHaveBeenCalledOnce()
  })

  it('should create missing tags and dedupe input before creating relations', async () => {
    prismaMocks.patch_tag_relation.findMany.mockResolvedValue([])
    prismaMocks.patch_tag.findMany.mockResolvedValue([])
    prismaMocks._tx.patch_tag.findMany.mockResolvedValue([
      { id: 2, name: '悬疑', alias: [] }
    ])

    await handleBatchPatchTags(10, [' 悬疑 ', '悬疑', ''], 100)

    expect(prismaMocks._tx.patch_tag.createMany).toHaveBeenCalledWith({
      data: [{ user_id: 100, name: '悬疑', source: 'self' }],
      skipDuplicates: true
    })
    expect(prismaMocks._tx.patch_tag_relation.createMany).toHaveBeenCalledWith({
      data: [{ patch_id: 10, tag_id: 2 }],
      skipDuplicates: true
    })
    expect(prismaMocks._tx.patch_tag.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
      data: { count: { increment: 1 } }
    })
  })

  it('should remove relations only when neither tag name nor aliases are submitted', async () => {
    prismaMocks.patch_tag_relation.findMany.mockResolvedValue([
      {
        tag_id: 1,
        tag: { id: 1, name: '纯爱', alias: ['純愛'], count: 3 }
      },
      {
        tag_id: 2,
        tag: { id: 2, name: '悬疑', alias: [], count: 1 }
      }
    ])
    prismaMocks.patch_tag.findMany.mockResolvedValue([])

    await handleBatchPatchTags(10, ['純愛'], 100)

    expect(prismaMocks._tx.patch_tag_relation.deleteMany).toHaveBeenCalledWith({
      where: { patch_id: 10, tag_id: { in: [2] } }
    })
    expect(prismaMocks._tx.patch_tag.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
      data: { count: { decrement: 1 } }
    })
  })
})
