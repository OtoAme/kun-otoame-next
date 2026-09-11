import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('~/utils/actions/verifyHeaderCookie', () => ({ verifyHeaderCookie: mocks.verify }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))

import { requireDashboardUser } from '~/lib/dashboard/auth'

describe('dashboard server authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('redirects missing sessions to login', async () => {
    mocks.verify.mockResolvedValue(null)
    await expect(requireDashboardUser()).rejects.toThrow('redirect:/login')
  })
  it.each([1, 2])('rejects role %s before rendering admin data', async (role) => {
    mocks.verify.mockResolvedValue({ uid: 4, name: '用户', role })
    await expect(requireDashboardUser()).rejects.toThrow('redirect:/')
  })
  it.each([3, 4])('allows administrator role %s', async (role) => {
    mocks.verify.mockResolvedValue({ uid: 4, name: '管理', role })
    await expect(requireDashboardUser()).resolves.toEqual({ id: 4, name: '管理', role })
  })
})
