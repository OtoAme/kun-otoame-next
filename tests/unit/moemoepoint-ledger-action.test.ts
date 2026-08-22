import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getMoemoepointLedger: vi.fn()
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/moemoepoint/query', () => ({
  getMoemoepointLedger: mocks.getMoemoepointLedger
}))

import { getAdminMoemoepointLedgerAction } from '~/app/admin/user/[id]/moemoepoint/actions'
import { getMyMoemoepointLedgerAction } from '~/app/moemoepoint/actions'

const query = { range: '30d' as const, page: 1, limit: 30 }

describe('moemoepoint ledger server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMoemoepointLedger.mockResolvedValue({ records: [] })
  })

  describe('admin action', () => {
    it('rejects invalid user IDs before auth or data access', async () => {
      const result = await getAdminMoemoepointLedgerAction(0, query)

      expect(typeof result).toBe('string')
      expect(mocks.verifyHeaderCookie).not.toHaveBeenCalled()
      expect(mocks.getMoemoepointLedger).not.toHaveBeenCalled()
    })

    it('requires authentication', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue(null)

      await expect(getAdminMoemoepointLedgerAction(7, query)).resolves.toBe(
        '请登录后查看萌萌点明细'
      )
      expect(mocks.getMoemoepointLedger).not.toHaveBeenCalled()
    })

    // 后台布局已经拦住 role < 3, 但 server action 是独立入口, 必须自己再挡一次。
    it('rejects an ordinary user reading another account', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 8, role: 1 })

      await expect(getAdminMoemoepointLedgerAction(7, query)).resolves.toBe(
        '您没有权限查看该用户的萌萌点明细'
      )
      expect(mocks.getMoemoepointLedger).not.toHaveBeenCalled()
    })

    it.each([
      { uid: 7, role: 1 },
      { uid: 8, role: 3 }
    ])('allows owner or admin access for $uid/$role', async (payload) => {
      mocks.verifyHeaderCookie.mockResolvedValue(payload)

      await getAdminMoemoepointLedgerAction(7, query)

      expect(mocks.getMoemoepointLedger).toHaveBeenCalledWith(7, query)
    })
  })

  describe('self action', () => {
    it('requires authentication', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue(null)

      await expect(getMyMoemoepointLedgerAction(query)).resolves.toBe(
        '请登录后查看萌萌点明细'
      )
      expect(mocks.getMoemoepointLedger).not.toHaveBeenCalled()
    })

    // 这个 action 不接受 userId, 所以无法被用来读别人的明细。
    it('always reads the caller own ledger', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 42, role: 1 })

      await getMyMoemoepointLedgerAction(query)

      expect(mocks.getMoemoepointLedger).toHaveBeenCalledWith(42, query)
    })

    it('rejects an invalid date range before touching the database', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 42, role: 1 })

      const result = await getMyMoemoepointLedgerAction({
        range: 'custom',
        page: 1,
        limit: 30
      })

      expect(typeof result).toBe('string')
      expect(mocks.getMoemoepointLedger).not.toHaveBeenCalled()
    })
  })
})
