import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))

import { getUserInfo } from '~/app/api/admin/user/get'

describe('admin user list service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the persisted total moemoepoint, including a negative balance', async () => {
    const created = new Date('2026-09-01T00:00:00.000Z')
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 7,
        name: '负数用户',
        email: 'negative@example.test',
        enable_2fa: false,
        bio: '简介',
        avatar: '',
        role: 1,
        status: 0,
        moemoepoint: -7,
        daily_image_count: 3,
        created,
        _count: { patch: 2, patch_resource: 4 }
      }
    ])
    prismaMock.user.count.mockResolvedValue(1)

    const result = await getUserInfo({
      page: 1,
      limit: 30,
      search: '',
      searchType: 'name'
    })

    expect(result).toEqual({
      users: [
        {
          id: 7,
          name: '负数用户',
          email: 'negative@example.test',
          enable2FA: false,
          bio: '简介',
          avatar: '',
          role: 1,
          status: 0,
          moemoepoint: -7,
          dailyImageCount: 3,
          created,
          _count: { patch: 2, patch_resource: 4 }
        }
      ],
      total: 1
    })
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: {} })
  })

  it('uses the existing search predicate for both rows and total', async () => {
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.user.count.mockResolvedValue(0)

    await getUserInfo({
      page: 2,
      limit: 50,
      search: ' 42 ',
      searchType: 'id'
    })

    const expectedWhere = { id: 42 }
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      take: 50,
      skip: 50,
      orderBy: { created: 'desc' },
      include: {
        _count: {
          select: {
            patch_resource: true,
            patch: true
          }
        }
      }
    })
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: expectedWhere
    })
  })
})
