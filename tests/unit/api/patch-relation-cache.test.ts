import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  patch: {
    findUnique: vi.fn()
  },
  patch_tag: {
    deleteMany: vi.fn(),
    updateMany: vi.fn()
  },
  patch_tag_relation: {
    createMany: vi.fn(),
    deleteMany: vi.fn()
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock)
  )
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

vi.mock('~/prisma', () => ({
  prisma: prismaMock
}))

const cacheMocks = vi.hoisted(() => ({
  invalidatePatchContentCache: vi.fn(),
  invalidateTagCaches: vi.fn(),
  invalidateCompanyCaches: vi.fn()
}))

vi.mock('~/app/api/patch/cache', () => cacheMocks)

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

const addPatchCompanyRelationsMock = vi.hoisted(() => vi.fn())
const removePatchCompanyRelationsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/companyRelationHelper', () => ({
  addPatchCompanyRelations: addPatchCompanyRelationsMock,
  removePatchCompanyRelations: removePatchCompanyRelationsMock
}))

import {
  handleAddPatchTag,
  handleRemovePatchTag
} from '~/app/api/patch/introduction/tag/service'
import { handlePatchCompanyAction } from '~/app/api/patch/introduction/company/service'
import { DELETE as clearEmptyTags } from '~/app/api/tag/clear-empty/route'

describe('patch relation cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.patch.findUnique.mockResolvedValue({ unique_id: 'abc12345' })
    prismaMock.patch_tag.deleteMany.mockResolvedValue({ count: 2 })
    prismaMock.patch_tag.updateMany.mockResolvedValue({})
    prismaMock.patch_tag_relation.createMany.mockResolvedValue({})
    prismaMock.patch_tag_relation.deleteMany.mockResolvedValue({})
    cacheMocks.invalidatePatchContentCache.mockResolvedValue(undefined)
    cacheMocks.invalidateTagCaches.mockResolvedValue(undefined)
    cacheMocks.invalidateCompanyCaches.mockResolvedValue(undefined)
    verifyHeaderCookieMock.mockResolvedValue({ uid: 9, role: 3 })
    addPatchCompanyRelationsMock.mockResolvedValue([3])
    removePatchCompanyRelationsMock.mockResolvedValue([3])
  })

  it('invalidates patch content and tag pages after adding detail tags', async () => {
    await handleAddPatchTag({ patchId: 7, tagId: [15] })

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidateTagCaches).toHaveBeenCalled()
  })

  it('invalidates patch content and tag pages after removing detail tags', async () => {
    await handleRemovePatchTag({ patchId: 7, tagId: [15] })

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidateTagCaches).toHaveBeenCalled()
  })

  it('invalidates patch content and company pages after changing detail companies', async () => {
    await handlePatchCompanyAction('add')({ patchId: 7, companyId: [3] })

    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidateCompanyCaches).toHaveBeenCalled()
  })

  it('invalidates tag caches after clearing empty tags', async () => {
    const response = await clearEmptyTags(
      new Request('https://example.test/api/tag/clear-empty') as never
    )
    const body = await response.json()

    expect(body).toEqual({ count: 2 })
    expect(cacheMocks.invalidateTagCaches).toHaveBeenCalled()
  })
})
