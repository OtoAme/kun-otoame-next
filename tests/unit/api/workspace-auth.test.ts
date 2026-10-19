import { beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => vi.fn())
vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: auth
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  }
}))
import { requireWorkspaceUser } from '~/lib/workspace/auth'
beforeEach(() => vi.resetAllMocks())
describe('workspace session guard', () => {
  it('accepts any signed-in role and maps only the session identity', async () => {
    auth.mockResolvedValue({
      uid: 7,
      role: 1,
      name: '普通用户',
      unrelated: 'private'
    })
    expect(await requireWorkspaceUser()).toEqual({
      id: 7,
      role: 1,
      name: '普通用户'
    })
  })
  it('redirects a missing session to login', async () => {
    auth.mockResolvedValue(null)
    await expect(requireWorkspaceUser()).rejects.toThrow('redirect:/login')
  })
})
