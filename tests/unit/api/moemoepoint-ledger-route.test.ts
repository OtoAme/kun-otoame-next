import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
const getMoemoepointLedgerMock = vi.hoisted(() => vi.fn())

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))
vi.mock('~/app/api/moemoepoint/query', () => ({
  getMoemoepointLedger: getMoemoepointLedgerMock
}))

import { GET } from '~/app/api/user/[id]/moemoepoint/ledger/route'

const request = () =>
  new NextRequest(
    'https://www.otoame.top/api/user/7/moemoepoint/ledger?range=7d&page=1&limit=30'
  )

describe('moemoepoint ledger route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMoemoepointLedgerMock.mockResolvedValue({
      user: { id: 7, name: 'Saya', avatar: '' },
      balance: { total: 10, reserved: 0, available: 10 },
      records: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
      range: { preset: '7d', start: '2026-08-11', end: '2026-08-17' }
    })
  })

  it('requires authentication and keeps the response private', async () => {
    verifyHeaderCookieMock.mockResolvedValue(null)

    const response = await GET(request(), {
      params: Promise.resolve({ id: '7' })
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getMoemoepointLedgerMock).not.toHaveBeenCalled()
  })

  it('rejects an ordinary user reading another account', async () => {
    verifyHeaderCookieMock.mockResolvedValue({ uid: 8, role: 1 })

    const response = await GET(request(), {
      params: Promise.resolve({ id: '7' })
    })

    expect(response.status).toBe(403)
    expect(getMoemoepointLedgerMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ uid: 7, role: 1 }, 'owner'],
    [{ uid: 8, role: 3 }, 'admin']
  ])('allows the %s to read the ledger', async (payload) => {
    verifyHeaderCookieMock.mockResolvedValue(payload)

    const response = await GET(request(), {
      params: Promise.resolve({ id: '7' })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getMoemoepointLedgerMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ range: '7d', page: 1, limit: 30 })
    )
  })
})
