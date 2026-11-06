import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import {
  HANDOVER_MESSAGES,
  ResourceMutationError
} from '~/app/api/patch/resource/mutation'

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  patch_resource: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn()
  },
  patch_resource_link: { findMany: vi.fn(), deleteMany: vi.fn() },
  patch_resource_link_history: { create: vi.fn() },
  patch_resource_access: { updateMany: vi.fn() },
  admin_log: { create: vi.fn() }
}))
const side = vi.hoisted(() => ({
  close: vi.fn(),
  reverse: vi.fn(),
  balance: vi.fn(),
  cache: vi.fn(),
  object: vi.fn(),
  attributes: vi.fn(),
  revalidate: vi.fn(),
  lock: vi.fn(),
  transfer: vi.fn(),
  queue: vi.fn(),
  process: vi.fn(),
  s3: vi.fn()
}))
const cleanupErrors = vi.hoisted(() => {
  class ResourceFileCleanupError extends Error {
    constructor(readonly code: string) {
      super(code)
      this.name = 'ResourceFileCleanupError'
    }
  }
  return { ResourceFileCleanupError }
})
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/prisma', () => ({ prisma: db }))
vi.mock('~/app/api/case/linkHealth', () => ({ closeLinkCases: side.close }))
vi.mock('~/app/api/case/service', () => ({
  transferPublisherCasesOnHandover: side.transfer
}))
vi.mock('~/app/api/moemoepoint/service', () => ({
  getCurrentBalance: side.balance,
  reverseMoemoepoint: side.reverse
}))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  deletePatchResourceCache: side.cache,
  deletePatchResourceLink: side.object,
  updatePatchAttributes: side.attributes,
  sanitizeResourceForAuditLog: (row: unknown) => row
}))
vi.mock('~/app/api/patch/revalidate', () => ({
  safeRevalidatePath: side.revalidate
}))
vi.mock('~/app/api/patch/resource/maintenance/service', () => ({
  lockLinkMaintenance: side.lock
}))
vi.mock('~/app/api/patch/resource/maintenance/read', () => ({
  resourceActionableMaintenanceCounts: async () => new Map(),
  getMaintenanceItem: async () => ({})
}))
vi.mock('~/app/api/patch/resource/linkHealthProjection', () => ({
  linkHealthSelect: () => ({ id: true }),
  getLinkDisputeSources: async () => new Map(),
  projectLinkHealth: (link: { version?: number }) => ({
    version: link.version ?? 1
  })
}))
vi.mock('~/app/api/patch/resource/update', () => ({
  updateWorkspacePatchResource: vi.fn()
}))
vi.mock('~/lib/s3', () => ({ deleteFileFromS3: side.s3 }))
vi.mock('~/lib/resourceFileCleanup', () => ({
  queueResourceFileCleanup: side.queue,
  processResourceFileCleanup: side.process,
  ResourceFileCleanupError: cleanupErrors.ResourceFileCleanupError
}))

import { deleteResource } from '~/app/api/patch/resource/delete'
import { deleteResource as adminDeleteResource } from '~/app/api/admin/resource/delete'
import {
  buildAdminResourceWhere,
  getPatchResource
} from '~/app/api/admin/resource/get'
import {
  deleteWorkspaceResource,
  getWorkspaceResource,
  getWorkspaceResources
} from '~/app/api/workspace/resources/service'
import { adminResourcePaginationSchema } from '~/validations/admin'
import { patchResourceDeleteQuerySchema } from '~/validations/patch'
import { workspaceResourceDeleteQuerySchema } from '~/validations/workspace'

const s3Key = `patch/20/resource/${'ab'.repeat(32)}/file.bin`
const userUrl = 'https://secret.example/path?code=hidden'
const balance = { total: 4, reserved: 1, available: 3 }
const backupAt = new Date('2026-01-01T00:00:00.000Z')
const userChangedAt = new Date('2026-04-01T00:00:00.000Z')
const author = { id: 7, role: 2, name: 'author' }

const makeResource = () => ({
  id: 10,
  patch_id: 20,
  user_id: 7,
  name: 'resource',
  section: 'galgame',
  status: 0,
  type: ['pc'],
  language: ['ja'],
  platform: ['windows'],
  note: 'private-note',
  patch: { unique_id: 'abcdefgh', name: 'game' },
  user: { name: 'author' },
  links: [
    {
      id: 1,
      version: 2,
      storage: 'touchgal',
      content: 'touchgal-internal',
      size: '1',
      code: '',
      password: '',
      hash: ''
    },
    {
      id: 2,
      version: 3,
      storage: 's3',
      content: s3Key,
      size: '2',
      code: '',
      password: '',
      hash: ''
    },
    {
      id: 3,
      version: 4,
      storage: 'user',
      content: userUrl,
      size: '3',
      code: 'secret-code',
      password: 'secret-pass',
      hash: 'secret-hash'
    }
  ]
})

let resource: ReturnType<typeof makeResource>
let leftAt: Date | null
let resourceGone: boolean
let handedOverIds: number[]
let listRows: unknown[]
let events: string[]

const handedOverLookup = (where: unknown) =>
  Boolean(
    where &&
      typeof where === 'object' &&
      Object.prototype.hasOwnProperty.call(where, 'publisher_left_at')
  )

beforeEach(() => {
  vi.clearAllMocks()
  resource = makeResource()
  leftAt = null
  resourceGone = false
  handedOverIds = []
  listRows = []
  events = []
  db.$transaction.mockImplementation(async (callback) => {
    events.push('begin')
    try {
      const result = await callback(db)
      events.push('commit')
      return result
    } catch (error) {
      events.push('rollback')
      throw error
    }
  })
  db.$queryRaw.mockImplementation(async () => [{ id: resource.id }])
  db.user.findUnique.mockResolvedValue({ id: 9, name: 'admin' })
  db.patch_resource.findUnique.mockImplementation(async (args) => {
    if (args?.select?.publisher_left_at && !args.include) {
      events.push('left-snapshot')
      return { publisher_left_at: resourceGone ? null : leftAt }
    }
    return resource
  })
  db.patch_resource.findFirst.mockResolvedValue({ id: resource.id })
  db.patch_resource.findMany.mockImplementation(async (args) => {
    if (handedOverLookup(args?.where)) {
      return handedOverIds.map((id) => ({ id }))
    }
    return listRows
  })
  db.patch_resource.updateMany.mockImplementation(async () => {
    events.push('mark')
    return { count: 1 }
  })
  db.patch_resource.delete.mockImplementation(async () => {
    events.push('delete')
    resourceGone = true
    return resource
  })
  db.patch_resource.count.mockResolvedValue(0)
  db.patch_resource_link.findMany.mockResolvedValue([
    {
      id: 1,
      resource_id: 10,
      storage: 'touchgal',
      attached_at: backupAt,
      content_changed_at: null
    },
    {
      id: 2,
      resource_id: 10,
      storage: 's3',
      attached_at: new Date('2026-03-01T00:00:00.000Z'),
      content_changed_at: null
    },
    {
      id: 3,
      resource_id: 10,
      storage: 'user',
      attached_at: new Date('2026-02-01T00:00:00.000Z'),
      content_changed_at: userChangedAt
    }
  ])
  db.patch_resource_link.deleteMany.mockImplementation(async (args) => {
    events.push('delete-links')
    return { count: args.where.id.in.length }
  })
  db.patch_resource_link_history.create.mockImplementation(async () => {
    events.push('history')
  })
  db.patch_resource_access.updateMany.mockResolvedValue({ count: 0 })
  db.admin_log.create.mockImplementation(async () => {
    events.push('log')
  })
  side.close.mockResolvedValue({ closedCaseIds: [] })
  side.reverse.mockResolvedValue({ balance })
  side.balance.mockResolvedValue(balance)
  side.attributes.mockResolvedValue('abcdefgh')
  side.transfer.mockResolvedValue(undefined)
  side.queue.mockImplementation(async () => {
    events.push('queue')
    expect(events).toContain('begin')
    expect(events).not.toContain('commit')
    return { jobIds: [41] }
  })
  side.process.mockImplementation(async (_client, options) => {
    events.push('process')
    expect(events).toContain('commit')
    await options.deleteObject(s3Key)
    return { examined: 1, completed: 1, cancelled: 0, failed: 0 }
  })
  side.s3.mockImplementation(async () => {
    events.push('s3')
    expect(events).toContain('commit')
  })
  side.cache.mockImplementation(async () => {
    expect(events).toContain('commit')
  })
  side.object.mockImplementation(async () => {
    events.push('legacy-object')
    expect(events).toContain('commit')
  })
})

describe('official mirror handover', () => {
  it('keeps an omitted touchgal delete from handing the card over', async () => {
    expect(await deleteResource({ resourceId: 10 }, 7, 2)).toBe(
      LINK_HEALTH_ERRORS.forbidden.message
    )
    expect(side.queue).not.toHaveBeenCalled()
    expect(side.close).not.toHaveBeenCalled()
    expect(side.reverse).not.toHaveBeenCalled()
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
    expect(events).toContain('rollback')
  })

  it('deletes and reverses points when an omitted action has no staff backup', async () => {
    resource.links = resource.links.filter((link) => link.storage !== 'touchgal')
    const result = await deleteResource({ resourceId: 10 }, 7, 2)
    expect(result).toMatchObject({ action: 'deleted', moemoepointBalance: balance })
    expect(side.reverse).toHaveBeenCalledTimes(1)
    expect(side.balance).not.toHaveBeenCalled()
    expect(side.queue).not.toHaveBeenCalled()
    expect(side.process).not.toHaveBeenCalled()
    expect(side.object).toHaveBeenCalledWith(s3Key)
    expect(events.indexOf('legacy-object')).toBeGreaterThan(events.indexOf('commit'))
  })

  it('rejects an explicit delete when a staff backup is present', async () => {
    expect(await deleteResource({ resourceId: 10, action: 'delete' }, 7, 2)).toBe(
      HANDOVER_MESSAGES.backupChanged
    )
    expect(side.queue).not.toHaveBeenCalled()
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
  })

  it('rejects handover when the locked card has no staff backup', async () => {
    resource.links = resource.links.filter((link) => link.storage !== 'touchgal')
    expect(
      await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    ).toBe(HANDOVER_MESSAGES.backupMissing)
    expect(side.queue).not.toHaveBeenCalled()
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
    expect(db.patch_resource.updateMany).not.toHaveBeenCalled()
  })

  it('hands the card over inside one transaction and cleans files only after commit', async () => {
    const result = await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    expect(result).toEqual({
      action: 'handed_over',
      balanceUserId: 7,
      moemoepointBalance: balance
    })
    expect(side.queue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        resourceId: 10,
        links: [
          expect.objectContaining({ storage: 's3', content: s3Key }),
          expect.objectContaining({ storage: 'user', content: userUrl })
        ]
      })
    )
    expect(side.queue.mock.calls[0][1].links).toHaveLength(2)
    expect(events.indexOf('queue')).toBeLessThan(events.indexOf('history'))
    expect(events.indexOf('queue')).toBeLessThan(events.indexOf('commit'))
    expect(events.indexOf('process')).toBeGreaterThan(events.indexOf('commit'))
    expect(events.indexOf('s3')).toBeGreaterThan(events.indexOf('commit'))
    expect(side.process).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ ids: [41] })
    )
    expect(side.lock).toHaveBeenCalledWith(db, [2, 3])
    expect(db.patch_resource_link_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ link_id: 2, reason: 'remove' })
      })
    )
    expect(db.patch_resource_access.updateMany).toHaveBeenCalledWith({
      where: { link_id: { in: [2, 3] } },
      data: { link_id: null }
    })
    expect(side.close).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        linkIds: [2, 3],
        resolution: 'link_removed',
        actorType: 'publisher',
        excludeRecipientIds: [7],
        suppressPublisher: true
      })
    )
    expect(db.patch_resource_link.deleteMany).toHaveBeenCalledWith({
      where: { resource_id: 10, id: { in: [2, 3] } }
    })
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
    expect(side.reverse).not.toHaveBeenCalled()
    expect(side.attributes).not.toHaveBeenCalled()
    expect(side.transfer).toHaveBeenCalledWith(db, 10, expect.any(Date))
    const log = db.admin_log.create.mock.calls[0][0].data
    expect(log.type).toBe('resource_handover')
    expect(log.user_id).toBe(7)
    expect(log.content).toContain('晚于备份时间的外部链接 1 条')
    expect(log.content).toContain(`链接 3 变动时间 ${userChangedAt.toISOString()}`)
    expect(log.content).toContain(`备份时间 ${backupAt.toISOString()}`)
    expect(log.content).not.toContain(userUrl)
    expect(log.content).not.toContain(s3Key)
    expect(log.content).not.toContain('secret-code')
    expect(log.content).not.toContain('secret-pass')
    expect(side.cache).toHaveBeenCalledWith('abcdefgh')
    expect(side.revalidate).toHaveBeenCalledWith('/user/7/resource', 'page')
  })

  it('still reports handover when a post-commit cache refresh fails', async () => {
    side.cache.mockRejectedValue(new Error('redis down'))
    await expect(
      deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    ).resolves.toMatchObject({ action: 'handed_over' })
    expect(side.process).toHaveBeenCalledTimes(1)
  })

  it('does not queue when the only remaining link is the staff backup', async () => {
    resource.links = resource.links.filter((link) => link.storage === 'touchgal')
    await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    expect(side.queue).not.toHaveBeenCalled()
    expect(side.process).not.toHaveBeenCalled()
    expect(db.patch_resource_link.deleteMany).not.toHaveBeenCalled()
    expect(events).toContain('mark')
    expect(events).toContain('log')
  })

  it('repeats a completed handover without another cleanup or ledger', async () => {
    leftAt = new Date('2026-10-01T00:00:00.000Z')
    const result = await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    expect(result).toMatchObject({
      action: 'handed_over',
      moemoepointBalance: balance
    })
    expect(side.queue).not.toHaveBeenCalled()
    expect(side.process).not.toHaveBeenCalled()
    expect(side.reverse).not.toHaveBeenCalled()
    expect(db.admin_log.create).not.toHaveBeenCalled()
    expect(db.patch_resource.updateMany).not.toHaveBeenCalled()
    expect(side.cache).not.toHaveBeenCalled()
    expect(side.balance).toHaveBeenCalledWith(db, 7)
  })

  it('forbids handover by staff and by someone who does not own the card', async () => {
    expect(
      await deleteResource({ resourceId: 10, action: 'handover' }, 7, 3)
    ).toBe(HANDOVER_MESSAGES.forbidden)
    expect(
      await deleteResource({ resourceId: 10, action: 'handover' }, 8, 2)
    ).toBe(HANDOVER_MESSAGES.forbidden)
    expect(side.queue).not.toHaveBeenCalled()
  })

  it('rolls the handover attempt back when a file locator is invalid', async () => {
    side.queue.mockImplementation(async () => {
      events.push('queue')
      throw new cleanupErrors.ResourceFileCleanupError('invalid_locator')
    })
    expect(
      await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    ).toBe(HANDOVER_MESSAGES.invalidLocator)
    expect(events).toContain('rollback')
    expect(events).not.toContain('commit')
    expect(db.patch_resource_link_history.create).not.toHaveBeenCalled()
    expect(db.patch_resource.updateMany).not.toHaveBeenCalled()
    expect(db.admin_log.create).not.toHaveBeenCalled()
    expect(side.process).not.toHaveBeenCalled()
  })

  it('does not store a cleanup outage as a failure category on the card', async () => {
    side.queue.mockImplementation(async () => {
      throw new cleanupErrors.ResourceFileCleanupError('invalid_resource')
    })
    expect(
      await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    ).toBe(HANDOVER_MESSAGES.cleanupUnavailable)
    expect(db.admin_log.create).not.toHaveBeenCalled()
  })

  it('returns the case conflict and does not write the handover log when transfer fails', async () => {
    side.transfer.mockImplementation(async () => {
      throw new ResourceMutationError(HANDOVER_MESSAGES.caseConflict, 409)
    })
    expect(
      await deleteResource({ resourceId: 10, action: 'handover' }, 7, 2)
    ).toBe(HANDOVER_MESSAGES.caseConflict)
    expect(db.admin_log.create).not.toHaveBeenCalled()
    expect(side.process).not.toHaveBeenCalled()
    expect(events).toContain('rollback')
  })

  it('does not reverse the publish reward when deleting a card the publisher already left', async () => {
    leftAt = new Date('2026-10-01T00:00:00.000Z')
    const result = await deleteResource({ resourceId: 10 }, 9, 4)
    expect(result).toMatchObject({ action: 'deleted' })
    expect(side.reverse).not.toHaveBeenCalled()
    expect(side.balance).toHaveBeenCalled()
    expect(side.queue).not.toHaveBeenCalled()
    expect(events.indexOf('left-snapshot')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('left-snapshot')).toBeLessThan(events.indexOf('delete'))
    expect(db.admin_log.create).toHaveBeenCalledTimes(1)
    expect(db.admin_log.create.mock.calls[0][0].data).toMatchObject({
      type: 'delete',
      user_id: 9
    })
    expect(db.admin_log.create.mock.calls[0][0].data.content).toContain(
      '已交接，保留原发布奖励'
    )
    expect(events.indexOf('log')).toBeLessThan(events.indexOf('commit'))
  })

  it('does not write the kept-reward note when an admin deletes a card still maintained by the publisher', async () => {
    const result = await deleteResource({ resourceId: 10 }, 9, 4)
    expect(result).toMatchObject({ action: 'deleted' })
    expect(side.reverse).toHaveBeenCalledTimes(1)
    expect(db.admin_log.create).not.toHaveBeenCalled()
  })

  it('blocks the original author from deleting after handover', async () => {
    leftAt = new Date('2026-10-01T00:00:00.000Z')
    expect(await deleteResource({ resourceId: 10, action: 'delete' }, 7, 2)).toBe(
      HANDOVER_MESSAGES.deleteClosed
    )
    expect(side.reverse).not.toHaveBeenCalled()
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
  })

  it('records that an admin delete of a handed card keeps the original reward', async () => {
    leftAt = new Date('2026-10-01T00:00:00.000Z')
    expect(await adminDeleteResource({ resourceId: 10 }, 9)).toEqual({})
    expect(side.reverse).not.toHaveBeenCalled()
    expect(side.queue).not.toHaveBeenCalled()
    expect(side.object).toHaveBeenCalledWith(s3Key)
    expect(db.admin_log.create.mock.calls[0][0].data.content).toContain(
      '已交接，保留原发布奖励'
    )
    expect(events.indexOf('left-snapshot')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('left-snapshot')).toBeLessThan(events.indexOf('delete'))
    expect(events.filter((event) => event === 'left-snapshot')).toHaveLength(1)
  })

  it('rejects request actions outside handover and delete before any write', () => {
    expect(
      patchResourceDeleteQuerySchema.safeParse({
        resourceId: '10',
        action: 'handed_over'
      }).success
    ).toBe(false)
    expect(
      patchResourceDeleteQuerySchema.safeParse({
        resourceId: '10',
        action: 'deleted'
      }).success
    ).toBe(false)
    expect(
      patchResourceDeleteQuerySchema.safeParse({ resourceId: '10', action: '' })
        .success
    ).toBe(false)
    expect(
      patchResourceDeleteQuerySchema.safeParse({ resourceId: '10' }).success
    ).toBe(true)
    expect(
      workspaceResourceDeleteQuerySchema.safeParse({ action: 'handed_over' })
        .success
    ).toBe(false)
    expect(workspaceResourceDeleteQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts only the two admin filter spellings and keeps them out of the sync where unless set', () => {
    expect(
      adminResourcePaginationSchema.safeParse({
        page: '1',
        limit: '30',
        hasStaffBackup: 'yes'
      }).success
    ).toBe(false)
    expect(
      adminResourcePaginationSchema.safeParse({
        page: '1',
        limit: '30',
        staffMaintained: '1'
      }).success
    ).toBe(false)
    const parsed = adminResourcePaginationSchema.parse({
      page: '1',
      limit: '30',
      hasStaffBackup: 'true'
    })
    expect(buildAdminResourceWhere(parsed, { content_limit: 'sfw' })).toEqual({
      AND: [
        { links: { some: { storage: 'touchgal' } } },
        { patch: { content_limit: 'sfw' } }
      ]
    })
    expect(
      buildAdminResourceWhere(
        adminResourcePaginationSchema.parse({
          page: '1',
          limit: '30',
          hasStaffBackup: 'false'
        }),
        {}
      )
    ).toEqual({
      AND: [{ links: { none: { storage: 'touchgal' } } }, { patch: {} }]
    })
    expect(
      buildAdminResourceWhere(
        adminResourcePaginationSchema.parse({ page: '1', limit: '30' }),
        { content_limit: 'sfw' }
      )
    ).toEqual({ AND: [{ patch: { content_limit: 'sfw' } }] })
  })

  it('filters staff maintenance with the handed-over id list after the sync where', async () => {
    handedOverIds = [8]
    await getPatchResource(
      adminResourcePaginationSchema.parse({
        page: '1',
        limit: '30',
        staffMaintained: 'true'
      }),
      {}
    )
    const listed = db.patch_resource.findMany.mock.calls.find(
      (call) => !handedOverLookup(call[0]?.where)
    )
    expect(listed?.[0].where).toEqual({
      AND: [{ AND: [{ patch: {} }] }, { id: { in: [8] } }]
    })
    db.patch_resource.findMany.mockClear()
    await getPatchResource(
      adminResourcePaginationSchema.parse({
        page: '1',
        limit: '30',
        staffMaintained: 'false'
      }),
      {}
    )
    const excluded = db.patch_resource.findMany.mock.calls.find(
      (call) => !handedOverLookup(call[0]?.where)
    )
    expect(excluded?.[0].where).toEqual({
      AND: [{ AND: [{ patch: {} }] }, { id: { notIn: [8] } }]
    })
    handedOverIds = []
    db.patch_resource.findMany.mockClear()
    await getPatchResource(
      adminResourcePaginationSchema.parse({
        page: '1',
        limit: '30',
        staffMaintained: 'false'
      }),
      { content_limit: 'sfw' }
    )
    const open = db.patch_resource.findMany.mock.calls.find(
      (call) => !handedOverLookup(call[0]?.where)
    )
    expect(open?.[0].where).toEqual({
      AND: [{ patch: { content_limit: 'sfw' } }]
    })
  })

  it('exposes backup and handover capabilities and hides a handed card from the author detail', async () => {
    listRows = [
      {
        ...resource,
        created: new Date('2026-10-19T00:00:00.000Z'),
        patch: { ...resource.patch, banner: 'https://example.test/banner.avif' }
      }
    ]
    const listed = await getWorkspaceResources(
      { page: 1, limit: 20, status: 'all', section: 'all' },
      author
    )
    expect(listed.items[0]).toMatchObject({
      hasStaffBackup: true,
      capabilities: { canHandover: true, canDelete: false, canEdit: true }
    })
    const staff = await getWorkspaceResources(
      { page: 1, limit: 20, status: 'all', section: 'all' },
      { ...author, role: 4 }
    )
    expect(staff.items[0]).toMatchObject({
      hasStaffBackup: true,
      capabilities: { canHandover: false, canDelete: true }
    })
    handedOverIds = [10]
    await expect(getWorkspaceResource(10, author)).rejects.toMatchObject({
      status: 404
    })
    expect(db.patch_resource.findFirst).not.toHaveBeenCalled()
  })

  it('maps workspace handover and delete to different success bodies', async () => {
    db.patch_resource.findFirst.mockResolvedValue({
      ...resource,
      created: new Date('2026-10-19T00:00:00.000Z'),
      patch: { ...resource.patch, banner: '' }
    })
    const handed = await deleteWorkspaceResource(10, author, 'handover')
    expect(handed).toEqual({
      deleted: false,
      handedOver: true,
      moemoepointBalance: balance
    })
    resource.links = resource.links.filter((link) => link.storage !== 'touchgal')
    const deleted = await deleteWorkspaceResource(10, author, 'delete')
    expect(deleted).toEqual({
      deleted: true,
      handedOver: false,
      moemoepointBalance: balance
    })
  })
})
