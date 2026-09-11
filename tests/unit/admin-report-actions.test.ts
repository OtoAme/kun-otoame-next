import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getReport: vi.fn()
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/admin/report/service', () => ({
  getReport: mocks.getReport
}))

import { kunGetActions as getReports } from '~/app/(site)/admin/report/actions'
import { kunGetActions as getRatingReports } from '~/app/(site)/admin/rating-report/actions'

describe.each([
  { name: 'report', action: getReports, targetType: 'comment' as const },
  { name: 'rating-report', action: getRatingReports, targetType: 'rating' as const }
])('legacy $name server action', ({ action, targetType }) => {
  const query = { page: 1, limit: 30, tab: 'pending' as const, targetType }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getReport.mockResolvedValue({ reports: [], total: 0 })
  })

  it.each([1, 2, 3])('rejects role %s before reading reports', async (role) => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role })

    await expect(action(query)).resolves.toBe('本页面仅超级管理员可访问')
    expect(mocks.getReport).not.toHaveBeenCalled()
  })

  it('allows a superadmin to load the validated report filter', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 4 })

    await expect(action(query)).resolves.toEqual({ reports: [], total: 0 })
    expect(mocks.getReport).toHaveBeenCalledExactlyOnceWith(query)
  })

  it('preserves the existing expired-session response', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue(null)

    await expect(action(query)).resolves.toBe('用户登陆失效')
    expect(mocks.getReport).not.toHaveBeenCalled()
  })

  it('rejects invalid pagination before authentication or data access', async () => {
    const result = await action({ ...query, page: 0 })

    expect(typeof result).toBe('string')
    expect(mocks.verifyHeaderCookie).not.toHaveBeenCalled()
    expect(mocks.getReport).not.toHaveBeenCalled()
  })
})
