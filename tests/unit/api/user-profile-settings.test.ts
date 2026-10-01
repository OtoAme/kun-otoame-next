import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn()
    }
  }
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx)
      )
    },
    tx,
    auth: vi.fn(),
    updateSessions: vi.fn(),
    spend: vi.fn()
  }
})

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.auth
}))
vi.mock('~/app/api/utils/jwt', () => ({
  updateKunSessions: mocks.updateSessions
}))
vi.mock('~/app/api/moemoepoint/service', () => ({
  spendMoemoepoint: mocks.spend,
  MoemoepointInsufficientError: class extends Error {}
}))

import { POST as updateUsername } from '~/app/api/user/setting/username/route'
import { POST as updateBio } from '~/app/api/user/setting/bio/route'

const user = {
  id: 1,
  name: 'CurrentName',
  bio: '当前签名',
  moemoepoint: 100,
  moemoepoint_reserved: 20
}
const balance = { total: 70, reserved: 20, available: 50 }
const request = (key: string, value: string) =>
  new NextRequest(`http://localhost/api/user/setting/${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value })
  })

describe('profile settings writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ uid: 1 })
    mocks.prisma.user.findUnique.mockResolvedValue(user)
    mocks.prisma.user.findFirst.mockResolvedValue(null)
    mocks.prisma.user.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.user.findUniqueOrThrow.mockResolvedValue({
      ...user,
      name: 'NewName',
      moemoepoint: 70
    })
    mocks.spend.mockResolvedValue({ balance })
  })

  it('returns the existing balance without a username write or fee for identical text', async () => {
    const response = await updateUsername(request('username', user.name))
    expect(await response.json()).toEqual({
      balance: { total: 100, reserved: 20, available: 80 }
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.prisma.user.findFirst).not.toHaveBeenCalled()
    expect(mocks.spend).not.toHaveBeenCalled()
    expect(mocks.updateSessions).not.toHaveBeenCalled()
  })

  it('accepts an unchanged trimmed username even when no balance is available', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...user, moemoepoint: 20 })
    const response = await updateUsername(
      request('username', `  ${user.name}  `)
    )
    expect(await response.json()).toEqual({
      balance: { total: 20, reserved: 20, available: 0 }
    })
    expect(mocks.spend).not.toHaveBeenCalled()
  })

  it('changes the username and charges the fee in the same transaction', async () => {
    const response = await updateUsername(request('username', ' NewName '))
    expect(await response.json()).toEqual({ balance })
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1, name: { not: 'NewName' } },
      data: { name: 'NewName' }
    })
    expect(mocks.spend).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ userId: 1, amount: 30 })
    )
    expect(mocks.updateSessions).toHaveBeenCalledWith(1, { name: 'NewName' })
  })

  it('does not charge again when another request has already saved the same username', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 })
    const response = await updateUsername(request('username', 'NewName'))
    expect(await response.json()).toEqual({ balance })
    expect(mocks.spend).not.toHaveBeenCalled()
    expect(mocks.updateSessions).not.toHaveBeenCalled()
  })

  it('recognizes its own saved username if it appears during the uniqueness check', async () => {
    mocks.prisma.user.findFirst.mockResolvedValue({
      ...user,
      name: 'NewName',
      moemoepoint: 70
    })
    const response = await updateUsername(request('username', 'NewName'))
    expect(await response.json()).toEqual({ balance })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.spend).not.toHaveBeenCalled()
  })

  it('still rejects another account’s username without charging', async () => {
    mocks.prisma.user.findFirst.mockResolvedValue({
      ...user,
      id: 2,
      name: 'NewName'
    })
    const response = await updateUsername(request('username', 'NewName'))
    expect(await response.json()).toBe('您的用户名已经有人注册了, 请修改')
    expect(mocks.spend).not.toHaveBeenCalled()
  })

  it.each([user.bio, `  ${user.bio}  `])(
    'does not write an unchanged signature: %s',
    async (bio) => {
      const response = await updateBio(request('bio', bio))
      expect(await response.json()).toEqual({})
      expect(mocks.prisma.user.update).not.toHaveBeenCalled()
      expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled()
    }
  )

  it('writes a changed signature using the normalized value and an unchanged-value guard', async () => {
    const response = await updateBio(request('bio', '  新签名  '))
    expect(await response.json()).toEqual({})
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1, bio: { not: '新签名' } },
      data: { bio: '新签名' }
    })
  })

  it.each([
    ['username', updateUsername],
    ['bio', updateBio]
  ])('requires authentication for %s', async (key, handler) => {
    mocks.auth.mockResolvedValue(null)
    const response = await handler(request(key, '新内容'))
    expect(await response.json()).toBe('用户未登录')
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
