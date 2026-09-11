import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = { user: { update: vi.fn() }, admin_log: { create: vi.fn() } }
  return {
    prisma: {
      user: { findUnique: vi.fn() },
      $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx)
      )
    },
    tx,
    deleteKunToken: vi.fn(),
    updateKunSessions: vi.fn(),
    hashPassword: vi.fn(),
    verifyHeaderCookie: vi.fn()
  }
})

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/utils/jwt', () => ({
  deleteKunToken: mocks.deleteKunToken,
  updateKunSessions: mocks.updateKunSessions
}))
vi.mock('~/app/api/utils/algorithm', () => ({
  hashPassword: mocks.hashPassword
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/admin/user/get', () => ({ getUserInfo: vi.fn() }))
vi.mock('~/app/api/admin/user/delete', () => ({ deleteUser: vi.fn() }))
vi.mock('~/app/api/admin/user/grant-moemoepoint', () => ({
  grantMoemoepoint: vi.fn()
}))

import { updateUser } from '~/app/api/admin/user/update'
import { PUT } from '~/app/api/admin/user/route'
import { adminUpdateUserSchema } from '~/validations/admin'

const target = {
  id: 10,
  name: 'original',
  email: 'original@example.test',
  bio: 'original bio',
  role: 4,
  status: 0,
  daily_image_count: 1
}
const input = {
  uid: target.id,
  name: target.name,
  email: target.email,
  bio: 'edited bio',
  role: 4,
  status: 0,
  dailyImageCount: 2,
  password: ''
}
const promotionError = '不能将用户提升为超级管理员'

const mockUsers = (targetRole = 4, adminRole = 4) => {
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === target.id) return { ...target, role: targetRole }
    if (where.id === 99) return { id: 99, name: 'operator', role: adminRole }
    return null
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.$transaction.mockImplementation((fn) => fn(mocks.tx))
  mocks.verifyHeaderCookie.mockResolvedValue({
    uid: 99,
    name: 'operator',
    role: 4
  })
  mockUsers()
})

describe('editing an existing super administrator', () => {
  it('accepts role 4 in the complete update form without changing its role', async () => {
    const parsed = adminUpdateUserSchema.safeParse(input)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    expect(await updateUser(parsed.data, 99)).toEqual({})

    expect(mocks.tx.user.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: target.id },
      data: {
        name: target.name,
        email: target.email,
        bio: 'edited bio',
        status: 0,
        daily_image_count: 2
      }
    })
    expect(mocks.tx.admin_log.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({ type: 'update', user_id: 99 })
    })
    expect(mocks.deleteKunToken).not.toHaveBeenCalled()
    expect(mocks.updateKunSessions).not.toHaveBeenCalled()
  })

  it.each([1, 2, 3])(
    'refuses to promote an existing role %i account to role 4',
    async (role) => {
      mockUsers(role)

      expect(await updateUser(input, 99)).toBe(promotionError)

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
      expect(mocks.tx.admin_log.create).not.toHaveBeenCalled()
      expect(mocks.deleteKunToken).not.toHaveBeenCalled()
      expect(mocks.updateKunSessions).not.toHaveBeenCalled()
    }
  )

  it('does not restore role 4 when another admin downgraded the user after the initial read', async () => {
    let storedRole = 4
    mocks.prisma.$transaction.mockImplementation(async (fn) => {
      storedRole = 3
      return fn(mocks.tx)
    })
    mocks.tx.user.update.mockImplementation(async ({ data }) => {
      if (data.role !== undefined) storedRole = data.role
      return { ...target, ...data, role: storedRole }
    })

    expect(await updateUser({ ...input, name: 'edited name' }, 99)).toEqual({})

    expect(storedRole).toBe(3)
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'role'
    )
    expect(mocks.updateKunSessions).toHaveBeenCalledExactlyOnceWith(target.id, {
      name: 'edited name'
    })
  })

  it.each([1, 2, 3])(
    'still allows an explicit role 4 downgrade to role %i and revokes sessions',
    async (role) => {
      expect(await updateUser({ ...input, role }, 99)).toEqual({})

      expect(mocks.tx.user.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: target.id },
        data: expect.objectContaining({ role, bio: 'edited bio' })
      })
      expect(mocks.deleteKunToken).toHaveBeenCalledExactlyOnceWith(target.id)
      expect(mocks.updateKunSessions).not.toHaveBeenCalled()
    }
  )

  it('keeps the existing role 1 to role 3 promotion available to a super administrator', async () => {
    mockUsers(1)

    expect(await updateUser({ ...input, role: 3 }, 99)).toEqual({})

    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: expect.objectContaining({ role: 3 })
    })
    expect(mocks.updateKunSessions).toHaveBeenCalledExactlyOnceWith(target.id, {
      role: 3
    })
  })

  it('retains password hashing and session revocation while keeping role 4', async () => {
    mocks.hashPassword.mockResolvedValue('test-hash')

    expect(
      await updateUser({ ...input, password: 'TestPassword1' }, 99)
    ).toEqual({})

    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith('TestPassword1')
    expect(mocks.deleteKunToken).toHaveBeenCalledExactlyOnceWith(target.id)
    const data = mocks.tx.user.update.mock.calls[0][0].data
    expect(data.password).toBe('test-hash')
    expect(data).not.toHaveProperty('role')
    const log = mocks.tx.admin_log.create.mock.calls[0][0].data.content
    expect(log).toContain('[REDACTED]')
    expect(log).not.toContain('TestPassword1')
  })
})

describe('user update HTTP permission boundary', () => {
  const request = (overrides: Partial<typeof input> = {}) =>
    new NextRequest('http://example.test/api/admin/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, ...overrides })
    })

  it.each([1.5, 3.5])(
    'rejects fractional role %s before accessing user data',
    async (role) => {
      const response = await PUT(request({ role }))

      expect(response.status).toBe(200)
      expect(typeof (await response.json())).toBe('string')
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
    }
  )

  it('returns success for a super administrator editing an existing role 4 account', async () => {
    const response = await PUT(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(mocks.tx.user.update).toHaveBeenCalledOnce()
  })

  it.each([1, 2, 3])(
    'continues to deny the update endpoint to role %i',
    async (role) => {
      mocks.verifyHeaderCookie.mockResolvedValue({
        uid: 99,
        name: 'operator',
        role
      })

      const response = await PUT(request())

      expect(response.status).toBe(200)
      expect(await response.json()).toBe('本页面仅超级管理员可访问')
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
    }
  )

  it('reports an attempted promotion to role 4 as the existing string-error response shape', async () => {
    mockUsers(3)

    const response = await PUT(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(promotionError)
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
  })
})
