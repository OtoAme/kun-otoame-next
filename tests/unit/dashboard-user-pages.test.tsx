import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React
const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('~/lib/dashboard/auth', () => ({ requireDashboardUser: mocks.auth }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  }
}))
vi.mock('~/components/dashboard/user/DashboardUsers', () => ({
  DashboardUsers: () => null
}))
vi.mock('~/components/dashboard/user/DashboardLedger', () => ({
  DashboardLedger: () => null
}))

import UsersPage from '~/app/(dashboard)/dashboard/user/page'
import LedgerPage from '~/app/(dashboard)/dashboard/user/[id]/moemoepoint/page'

describe('dashboard user migration page permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ id: 34, name: '管理员', role: 3 })
  })

  it('keeps the user list restricted to super administrators', async () => {
    const result = await UsersPage()
    expect(result.type).toBe('p')
    expect(result.props.role).toBe('alert')
    expect(result.props.children).toBe('本页面仅超级管理员可访问')
  })

  it('passes the authenticated operator to the role 4 list', async () => {
    mocks.auth.mockResolvedValue({ id: 44, name: '超级管理员', role: 4 })
    expect((await UsersPage()).props).toEqual({ currentUserId: 44 })
  })

  it('allows role 3 to open another user ledger independently of the list gate', async () => {
    const result = await LedgerPage({ params: Promise.resolve({ id: '0007' }) })
    expect(result.props).toEqual({ userId: 7, currentUserId: 34 })
    expect(result.key).toBe('7')
  })

  it.each([
    '0',
    '-1',
    '7x',
    '1.5',
    '1e3',
    '10000000',
    '99999999999999999999999999999'
  ])('rejects invalid ledger ID %s', async (id) => {
    await expect(
      LedgerPage({ params: Promise.resolve({ id }) })
    ).rejects.toThrow('not-found')
  })

  it('checks authentication before either page renders', async () => {
    mocks.auth.mockRejectedValue(new Error('unauthorized'))
    await expect(UsersPage()).rejects.toThrow('unauthorized')
    await expect(
      LedgerPage({ params: Promise.resolve({ id: '7' }) })
    ).rejects.toThrow('unauthorized')
  })
})
