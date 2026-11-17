import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  visibility: vi.fn(),
  findPatch: vi.fn(),
  content: vi.fn()
}))
vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.identity
}))
vi.mock('~/utils/actions/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: mocks.visibility
}))
vi.mock('~/app/api/patch/pageData', () => ({ getPatchPageData: mocks.content }))
vi.mock('~/prisma', () => ({
  prisma: { patch: { findFirst: mocks.findPatch } }
}))
import { kunGetPatchPageDataActions } from '~/app/(site)/[id]/actions'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.identity.mockResolvedValue(null)
  mocks.visibility.mockResolvedValue({ content_limit: 'sfw' })
  mocks.content.mockResolvedValue({
    patch: { name: 'restricted title' },
    intro: { introduction: 'restricted body' }
  })
})

describe('patch page server content visibility', () => {
  it('does not serialize restricted content into client props or metadata', async () => {
    mocks.findPatch.mockResolvedValue(null)
    expect(await kunGetPatchPageDataActions({ uniqueId: 'AbCd1234' })).toEqual(
      expect.any(String)
    )
    expect(mocks.content).not.toHaveBeenCalled()
  })

  it('returns content only after the shared visibility rule permits the patch', async () => {
    mocks.findPatch.mockResolvedValue({ id: 7 })
    expect(
      await kunGetPatchPageDataActions({ uniqueId: 'AbCd1234' })
    ).toMatchObject({ patch: { name: 'restricted title' } })
    expect(mocks.findPatch).toHaveBeenCalledWith({
      where: { unique_id: 'AbCd1234', content_limit: 'sfw' },
      select: { id: true }
    })
  })
})
