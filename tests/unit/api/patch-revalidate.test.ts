import { beforeEach, describe, expect, it, vi } from 'vitest'

const revalidatePathMock = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock
}))

import { safeRevalidatePath } from '~/app/api/patch/revalidate'

describe('safeRevalidatePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls Next revalidatePath with the route and type', () => {
    safeRevalidatePath('/company/7', 'page')

    expect(revalidatePathMock).toHaveBeenCalledWith('/company/7', 'page')
  })

  it('does not throw when called outside a Next static generation context', () => {
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error('Invariant: static generation store missing')
    })

    expect(() => safeRevalidatePath('/tag/15', 'page')).not.toThrow()
  })
})
