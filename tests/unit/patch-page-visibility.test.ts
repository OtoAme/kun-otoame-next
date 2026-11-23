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
  it.each(['sfw', 'nsfw'])(
    'returns a content preference notice when %s mode alone blocks the patch',
    async (mode) => {
      mocks.visibility.mockResolvedValue({ content_limit: mode })
      mocks.findPatch
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 7 })

      expect(
        await kunGetPatchPageDataActions({ uniqueId: 'AbCd1234' })
      ).toEqual({
        blockedBy: 'content-preference'
      })
      expect(mocks.content).not.toHaveBeenCalled()
    }
  )

  it('keeps blocked tags enforced when identifying a content preference mismatch', async () => {
    const tagFilter = { NOT: { tag: { some: { tag_id: { in: [3] } } } } }
    mocks.visibility.mockResolvedValue({ content_limit: 'sfw', ...tagFilter })
    mocks.findPatch.mockResolvedValue(null)

    expect(await kunGetPatchPageDataActions({ uniqueId: 'AbCd1234' })).toEqual(
      expect.any(String)
    )
    expect(mocks.findPatch).toHaveBeenLastCalledWith({
      where: { unique_id: 'AbCd1234', ...tagFilter },
      select: { id: true }
    })
    expect(mocks.content).not.toHaveBeenCalled()
  })

  it('does not suggest changing content mode when all content is already enabled', async () => {
    mocks.visibility.mockResolvedValue({})
    mocks.findPatch.mockResolvedValue(null)

    expect(await kunGetPatchPageDataActions({ uniqueId: 'AbCd1234' })).toEqual(
      expect.any(String)
    )
    expect(mocks.findPatch).toHaveBeenCalledOnce()
    expect(mocks.content).not.toHaveBeenCalled()
  })

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
