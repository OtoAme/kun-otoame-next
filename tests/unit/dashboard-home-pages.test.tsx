import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React
const mocks = vi.hoisted(() => ({ auth: vi.fn(), redirect: vi.fn() }))
vi.mock('~/lib/dashboard/auth', () => ({ requireDashboardUser: mocks.auth }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url)
    throw new Error(`redirect:${url}`)
  }
}))
vi.mock('~/components/dashboard/DashboardStats', () => ({
  DashboardStats: () => null
}))
vi.mock('~/components/dashboard/DashboardInbox', () => ({
  DashboardInbox: () => null
}))

import { DashboardStats } from '~/components/dashboard/DashboardStats'
import { DashboardInbox } from '~/components/dashboard/DashboardInbox'
import HomePage from '~/app/(dashboard)/dashboard/page'
import InboxPage from '~/app/(dashboard)/dashboard/inbox/page'

const renderHome = (params: Record<string, string | string[] | undefined>) =>
  HomePage({ searchParams: Promise.resolve(params) })

describe('dashboard home and inbox pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ id: 34, name: '管理员', role: 3 })
  })

  it.each([3, 4])(
    'renders the stats overview with reviewer role %i and no redirect',
    async (role) => {
      mocks.auth.mockResolvedValue({ id: role, name: '管理员', role })
      const result = await renderHome({})
      expect(result.type).toBe(DashboardStats)
      expect(result.props).toEqual({ reviewerRole: role })
      expect(mocks.redirect).not.toHaveBeenCalled()
    }
  )

  it('renders stats when only unrelated params are present', async () => {
    const result = await renderHome({ from: 'legacy' })
    expect(result.type).toBe(DashboardStats)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each(['kinds', 'kind', 'id', 'search', 'order'])(
    'redirects to the inbox when param %s is present even if empty',
    async (key) => {
      await expect(renderHome({ [key]: '' })).rejects.toThrow('redirect:')
      expect(mocks.redirect).toHaveBeenCalledWith(`/dashboard/inbox?${key}=`)
    }
  )

  it('preserves repeated keys, unknown params and empty values in order', async () => {
    await expect(
      renderHome({
        search: ['旧作', '补丁'],
        kinds: 'submission',
        extra: '1',
        flag: ''
      })
    ).rejects.toThrow('redirect:')
    const expected = new URLSearchParams()
    expected.append('search', '旧作')
    expected.append('search', '补丁')
    expected.append('kinds', 'submission')
    expected.append('extra', '1')
    expected.append('flag', '')
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/dashboard/inbox?${expected.toString()}`
    )
  })

  it('passes the authenticated reviewer to the inbox page', async () => {
    const result = await InboxPage()
    expect(result.type).toBe(DashboardInbox)
    expect(result.props).toEqual({ reviewerId: 34, reviewerRole: 3 })
  })

  it('rejects unauthenticated access before either page renders', async () => {
    mocks.auth.mockRejectedValue(new Error('unauthorized'))
    await expect(renderHome({})).rejects.toThrow('unauthorized')
    await expect(InboxPage()).rejects.toThrow('unauthorized')
  })
})
