import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    patch_resource: { count: vi.fn() },
    user_message: { findFirst: vi.fn() }
  },
  createMessage: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/utils/message', () => ({
  createMessage: mocks.createMessage
}))

import { applyForCreator, getApplyStatus } from '~/app/api/apply/service'
import { getApplyStatus as getStatus } from '~/app/api/apply/status/service'

const uid = 21
let resources: { user_id: number; status: number }[]

const scenarios = [
  { name: 'no resources', statuses: [], count: 0 },
  { name: 'only pending resources', statuses: [2, 2, 2], count: 0 },
  { name: 'two approved and one pending', statuses: [0, 0, 2], count: 2 },
  { name: 'two approved and one banned', statuses: [0, 0, 1], count: 2 },
  { name: 'three approved resources', statuses: [0, 0, 0], count: 3 },
  { name: 'more than three approved resources', statuses: [0, 0, 0, 0], count: 4 }
]

beforeEach(() => {
  vi.resetAllMocks()
  resources = []
  mocks.prisma.user.findUnique.mockImplementation(async ({ where, include }) => {
    const selection = include?._count.select.patch_resource
    const status = selection === true ? undefined : selection?.where.status
    return {
      id: where.id,
      name: '申请人',
      role: 1,
      _count: {
        patch_resource: resources.filter(
          (resource) =>
            resource.user_id === where.id &&
            (status === undefined || resource.status === status)
        ).length
      }
    }
  })
  mocks.prisma.patch_resource.count.mockImplementation(async ({ where }) =>
    resources.filter(
      (resource) =>
        resource.user_id === where.user_id &&
        (where.status === undefined || resource.status === where.status)
    ).length
  )
  mocks.prisma.user_message.findFirst.mockResolvedValue(null)
  mocks.prisma.user.findMany.mockResolvedValue([{ id: 3 }])
})

const setResources = (statuses: number[]) => {
  resources = [
    ...statuses.map((status) => ({ user_id: uid, status })),
    ...[0, 0, 0].map((status) => ({ user_id: 99, status }))
  ]
}

describe.each([
  { name: 'application page and API status', read: getApplyStatus },
  { name: 'status service', read: getStatus }
])('$name', ({ read }) => {
  it.each(scenarios)(
    'counts approved resources: $name',
    async ({ statuses, count }) => {
      setResources(statuses)

      await expect(read(uid)).resolves.toEqual({ count, role: 1 })
    }
  )
})

describe('applyForCreator', () => {
  it.each(scenarios)('checks eligibility: $name', async ({ statuses, count }) => {
    setResources(statuses)

    const result = await applyForCreator(uid)

    if (count < 3) {
      expect(result).toBe(
        '您需要至少 3 个审核通过的游戏 / 补丁资源才能申请成为创作者'
      )
      expect(mocks.createMessage).not.toHaveBeenCalled()
      return
    }

    expect(result).toEqual({})
    expect(mocks.createMessage).toHaveBeenCalledTimes(2)
    expect(mocks.createMessage).toHaveBeenCalledWith({
      type: 'apply',
      content: '申请成为创作者',
      sender_id: uid,
      link: `/user/${uid}/resource`
    })
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_id: 3, link: '/admin/creator' })
    )
  })

  it('does not submit another application while one is pending', async () => {
    setResources([0, 0, 0])
    mocks.prisma.user_message.findFirst.mockResolvedValue({ id: 7 })

    await expect(applyForCreator(uid)).resolves.toBe(
      '您有一条正在进行中的申请, 请等待该申请的完成'
    )
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })
})
