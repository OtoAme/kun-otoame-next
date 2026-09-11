import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_resource: {
      updateMany: vi.fn(),
      deleteMany: vi.fn()
    },
    admin_log: { create: vi.fn() },
    user_message: { create: vi.fn() }
  }
  return {
    patch_resource: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    _tx: tx
  }
})

const helperMocks = vi.hoisted(() => ({
  updatePatchAttributes: vi.fn(),
  deletePatchResourceCache: vi.fn(),
  deletePatchResourceLink: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))
vi.mock('~/app/api/patch/resource/_helper', () => helperMocks)

import {
  approvePatchResource,
  declinePatchResource
} from '~/app/api/admin/resource-apply/service'
import { ADMIN_LOG_TYPE_MAP } from '~/constants/admin'

const tx = prismaMocks._tx
const stateChangedMessage = '当前资源状态无需审核'
const pendingResource = {
  id: 10,
  status: 2,
  section: 'galgame',
  name: '分享的游戏',
  user_id: 5,
  patch_id: 20,
  user: { name: '分享者' },
  patch: { name: '游戏条目', unique_id: 'abcd1234' },
  links: [
    { storage: 's3', content: 'https://storage.example.test/first.zip' },
    { storage: 's3', content: 'https://storage.example.test/first.zip' },
    { storage: 's3', content: 'https://storage.example.test/second.zip' },
    { storage: 'user', content: 'https://example.test/mirror' }
  ]
}

const actions = [
  {
    name: 'approve',
    run: () => approvePatchResource({ resourceId: 10 }, 3),
    claim: tx.patch_resource.updateMany,
    claimArgs: { where: { id: 10, status: 2 }, data: { status: { set: 0 } } },
    logType: 'resource_apply_approve',
    message: {
      content: '你上传的游戏资源「分享的游戏」已通过审核，感谢你的分享！',
      link: '/abcd1234'
    }
  },
  {
    name: 'decline',
    run: () => declinePatchResource({ resourceId: 10, reason: '链接无效' }, 3),
    claim: tx.patch_resource.deleteMany,
    claimArgs: { where: { id: 10, status: 2 } },
    logType: 'resource_apply_decline',
    message: {
      content: '你上传的游戏资源「分享的游戏」未通过审核，原因：链接无效',
      link: '/'
    }
  }
] as const

beforeEach(() => {
  vi.resetAllMocks()
  prismaMocks.$transaction.mockImplementation((fn) => fn(tx))
  prismaMocks.patch_resource.findUnique.mockResolvedValue(pendingResource)
  prismaMocks.user.findUnique.mockResolvedValue({ id: 3, name: '管理员' })
  tx.patch_resource.updateMany.mockResolvedValue({ count: 1 })
  tx.patch_resource.deleteMany.mockResolvedValue({ count: 1 })
  helperMocks.updatePatchAttributes.mockResolvedValue('abcd1234')
})

const expectNoEffects = () => {
  expect(helperMocks.updatePatchAttributes).not.toHaveBeenCalled()
  expect(tx.user_message.create).not.toHaveBeenCalled()
  expect(tx.admin_log.create).not.toHaveBeenCalled()
  expect(helperMocks.deletePatchResourceCache).not.toHaveBeenCalled()
  expect(helperMocks.deletePatchResourceLink).not.toHaveBeenCalled()
}

describe.each(actions)('$name pending resource', (action) => {
  it('claims only a pending resource and records one transactional notification and review log', async () => {
    expect(await action.run()).toEqual({})

    expect(action.claim).toHaveBeenCalledExactlyOnceWith(action.claimArgs)
    expect(helperMocks.updatePatchAttributes).toHaveBeenCalledExactlyOnceWith(
      20,
      tx
    )
    expect(tx.user_message.create).toHaveBeenCalledExactlyOnceWith({
      data: { type: 'system', recipient_id: 5, ...action.message }
    })
    expect(tx.admin_log.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        type: action.logType,
        user_id: 3,
        content: expect.stringContaining('资源 ID:10')
      }
    })
    expect(
      helperMocks.deletePatchResourceCache
    ).toHaveBeenCalledExactlyOnceWith('abcd1234')
  })

  it('returns the state-changed message without effects when another request wins', async () => {
    action.claim.mockResolvedValue({ count: 0 })

    expect(await action.run()).toBe(stateChangedMessage)

    expect(action.claim).toHaveBeenCalledExactlyOnceWith(action.claimArgs)
    expectNoEffects()
  })

  it('does not invalidate caches or remove objects if the transaction cannot commit', async () => {
    prismaMocks.$transaction.mockImplementationOnce(async (fn) => {
      await fn(tx)
      throw new Error('transaction failed')
    })

    await expect(action.run()).rejects.toThrow('transaction failed')

    expect(helperMocks.deletePatchResourceCache).not.toHaveBeenCalled()
    expect(helperMocks.deletePatchResourceLink).not.toHaveBeenCalled()
  })

  it('returns the existing missing-resource error without entering a transaction', async () => {
    prismaMocks.patch_resource.findUnique.mockResolvedValue(null)

    expect(await action.run()).toBe('该资源不存在')

    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
    expectNoEffects()
  })
})

describe('resource review races', () => {
  it.each([
    { first: actions[0], second: actions[0] },
    { first: actions[1], second: actions[1] },
    { first: actions[0], second: actions[1] },
    { first: actions[1], second: actions[0] }
  ])(
    'only the first $first.name wins against a competing $second.name',
    async ({ first, second }) => {
      let pending = true
      const claim = async () => {
        if (!pending) {
          return { count: 0 }
        }
        pending = false
        return { count: 1 }
      }
      tx.patch_resource.updateMany.mockImplementation(claim)
      tx.patch_resource.deleteMany.mockImplementation(claim)

      const results = await Promise.all([first.run(), second.run()])

      expect(results).toEqual([{}, stateChangedMessage])
      expect(helperMocks.updatePatchAttributes).toHaveBeenCalledExactlyOnceWith(
        20,
        tx
      )
      expect(tx.user_message.create).toHaveBeenCalledExactlyOnceWith({
        data: { type: 'system', recipient_id: 5, ...first.message }
      })
      expect(tx.admin_log.create).toHaveBeenCalledExactlyOnceWith({
        data: expect.objectContaining({ type: first.logType, user_id: 3 })
      })
      expect(
        helperMocks.deletePatchResourceCache
      ).toHaveBeenCalledExactlyOnceWith('abcd1234')
      expect(helperMocks.deletePatchResourceLink).toHaveBeenCalledTimes(
        first.name === 'decline' ? 2 : 0
      )
    }
  )

  it.each([0, 1])(
    'does not decline a resource already in status %i',
    async (status) => {
      prismaMocks.patch_resource.findUnique.mockResolvedValue({
        ...pendingResource,
        status
      })
      tx.patch_resource.deleteMany.mockResolvedValue({ count: 0 })

      expect(await actions[1].run()).toBe(stateChangedMessage)

      expectNoEffects()
    }
  )
})

describe('resource review cleanup', () => {
  it('removes each S3 object once only after the decline transaction commits', async () => {
    let committed = false
    prismaMocks.$transaction.mockImplementationOnce(async (fn) => {
      const result = await fn(tx)
      expect(helperMocks.deletePatchResourceCache).not.toHaveBeenCalled()
      expect(helperMocks.deletePatchResourceLink).not.toHaveBeenCalled()
      committed = true
      return result
    })
    helperMocks.deletePatchResourceCache.mockImplementation(async () => {
      expect(committed).toBe(true)
    })
    helperMocks.deletePatchResourceLink.mockImplementation(async () => {
      expect(committed).toBe(true)
    })

    expect(await actions[1].run()).toEqual({})

    expect(helperMocks.deletePatchResourceLink.mock.calls).toEqual([
      ['https://storage.example.test/first.zip'],
      ['https://storage.example.test/second.zip']
    ])
  })

  it('keeps S3 objects when a resource is approved', async () => {
    expect(await actions[0].run()).toEqual({})

    expect(helperMocks.deletePatchResourceLink).not.toHaveBeenCalled()
  })
})

it('labels the dedicated review log types in Chinese', () => {
  expect(ADMIN_LOG_TYPE_MAP).toMatchObject({
    submission_review: '投稿审核',
    resource_apply_approve: '资源申请通过',
    resource_apply_decline: '资源申请拒绝'
  })
})
