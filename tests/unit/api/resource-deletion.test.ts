import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  patch_resource_link_maintenance: { findUnique: vi.fn() },
  patch_resource: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn()
  },
  patch: { findUnique: vi.fn(), delete: vi.fn() },
  patch_game_image: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  admin_log: { create: vi.fn() },
  user_message: { create: vi.fn() }
}))
const side = vi.hoisted(() => ({
  close: vi.fn(),
  reverse: vi.fn(),
  cache: vi.fn(),
  object: vi.fn(),
  attributes: vi.fn(),
  outbox: vi.fn(),
  process: vi.fn(),
  content: vi.fn(),
  list: vi.fn(),
  tags: vi.fn(),
  companies: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/linkHealth', () => ({ closeLinkCases: side.close }))
vi.mock('~/app/api/moemoepoint/service', () => ({
  reverseMoemoepoint: side.reverse
}))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  deletePatchResourceCache: side.cache,
  deletePatchResourceLink: side.object,
  updatePatchAttributes: side.attributes,
  extractS3Key: () => null,
  sanitizeResourceForAuditLog: (row: unknown) => row
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: side.content,
  invalidatePatchListCaches: side.list,
  invalidateTagCaches: side.tags,
  invalidateCompanyCaches: side.companies
}))
vi.mock('~/lib/s3', () => ({ deleteFileFromS3: vi.fn() }))
vi.mock('~/app/api/patch-submission/orphanCleanup', () => ({
  PATCH_SUBMISSION_ASSET_PREFIX: 'patch-submission/',
  enqueueSubmissionOrphanCleanupJobs: side.outbox,
  processSubmissionOrphanCleanupJobsBestEffort: side.process
}))
import { deleteResource as publisherDelete } from '~/app/api/patch/resource/delete'
import { deleteResource as adminDelete } from '~/app/api/admin/resource/delete'
import { declinePatchResource } from '~/app/api/admin/resource-apply/service'
import { deletePatchById } from '~/app/api/patch/delete'
const makeResource = () => ({
  id: 10,
  patch_id: 20,
  user_id: 7,
  name: 'resource',
  section: 'galgame',
  status: 0,
  type: [],
  language: [],
  platform: [],
  note: '',
  patch: { unique_id: 'abcdefgh', name: 'game' },
  user: { name: 'author' },
  links: [
    { id: 30, version: 1, storage: 's3', content: 'https://example.test/asset' }
  ]
})
let resource: ReturnType<typeof makeResource>
let events: string[]
beforeEach(() => {
  vi.resetAllMocks()
  resource = makeResource()
  events = []
  db.$transaction.mockImplementation(async (callback) => {
    events.push('begin')
    const result = await callback(db)
    events.push('commit')
    return result
  })
  db.$queryRaw.mockImplementation(async (query) => {
    const sql = query.sql ?? ''
    events.push(
      sql.includes('patch_resource_link')
        ? 'links-lock'
        : sql.includes('FROM patch_resource')
          ? 'resource-lock'
          : 'patch-lock'
    )
    return [{ id: 10 }]
  })
  db.patch_resource.findUnique.mockImplementation(async () => resource)
  db.patch_resource.findMany.mockImplementation(async () => [resource])
  db.patch_resource.delete.mockImplementation(async () => {
    events.push('delete')
    return resource
  })
  db.patch_resource.deleteMany.mockImplementation(async () => {
    events.push('delete')
    return { count: 1 }
  })
  db.patch.findUnique.mockResolvedValue({
    id: 20,
    unique_id: 'abcdefgh',
    name: 'game',
    company: [],
    banner: ''
  })
  db.patch_game_image.findMany.mockResolvedValue([])
  db.user.findUnique.mockResolvedValue({ id: 9, name: 'admin' })
  side.close.mockImplementation(async () => {
    events.push('close')
    return { closedCaseIds: [5] }
  })
  side.reverse.mockResolvedValue({
    balance: { total: 1, reserved: 0, available: 1 }
  })
  side.attributes.mockResolvedValue('abcdefgh')
  side.cache.mockImplementation(async () => {
    expect(events).toContain('commit')
  })
  side.object.mockImplementation(async () => {
    expect(events).toContain('commit')
  })
})
describe('transaction-owned deletion chains', () => {
  it('rechecks workspace ownership under lock even for an administrator', async () => {
    resource.user_id = 8
    expect(await publisherDelete({ resourceId: 10 }, 7, 4, { expectedOwnerId: 7 })).toBe('您没有权限操作该资源')
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
    expect(side.reverse).not.toHaveBeenCalled()
    expect(side.close).not.toHaveBeenCalled()
  })
  it.each([
    {
      name: 'publisher',
      run: () => publisherDelete({ resourceId: 10 }, 7, 2),
      reward: true
    },
    {
      name: 'admin',
      run: () => adminDelete({ resourceId: 10 }, 9),
      reward: false
    },
    {
      name: 'decline',
      run: () =>
        declinePatchResource({ resourceId: 10, reason: 'synthetic' }, 9),
      reward: false
    },
    {
      name: 'patch',
      run: () => deletePatchById({ patchId: 20 }),
      reward: false
    }
  ])(
    '$name closes link cases from locked current targets before deletion and preserves reward policy',
    async ({ name, run, reward }) => {
      if (name === 'decline') resource.status = 2
      await run()
      expect(events.indexOf('close')).toBeGreaterThan(
        events.indexOf('links-lock')
      )
      expect(events.indexOf('close')).toBeLessThan(events.indexOf('delete'))
      expect(side.close).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          resourceIds: [10],
          resolution: 'link_removed'
        })
      )
      expect(side.reverse).toHaveBeenCalledTimes(reward ? 1 : 0)
      expect(side.object).toHaveBeenCalledWith('https://example.test/asset')
      if (name === 'patch')
        expect(events.slice(1, 4)).toEqual([
          'patch-lock',
          'resource-lock',
          'links-lock'
        ])
    }
  )
  it('refuses an ordinary resource deletion containing a protected disk link before closure or accounting', async () => {
    resource.links[0].storage = 'touchgal'
    expect(typeof (await publisherDelete({ resourceId: 10 }, 7, 2))).toBe(
      'string'
    )
    expect(side.close).not.toHaveBeenCalled()
    expect(side.reverse).not.toHaveBeenCalled()
    expect(db.patch_resource.delete).not.toHaveBeenCalled()
  })
  it('never closes rejected-review cases when the locked resource is no longer pending', async () => {
    const result = await declinePatchResource(
      { resourceId: 10, reason: 'synthetic' },
      9
    )
    expect(result).toBe('当前资源状态无需审核')
    expect(side.close).not.toHaveBeenCalled()
    expect(db.patch_resource.deleteMany).not.toHaveBeenCalled()
  })
  it('aborts instead of committing a closure when a pending delete guard loses', async () => {
    resource.status = 2
    db.patch_resource.deleteMany.mockResolvedValue({ count: 0 })
    expect(
      await declinePatchResource({ resourceId: 10, reason: 'synthetic' }, 9)
    ).toBe('当前资源状态无需审核')
    expect(events).not.toContain('commit')
    expect(db.user_message.create).not.toHaveBeenCalled()
    expect(side.cache).not.toHaveBeenCalled()
  })
  it('reads actual patch resources after its parent lock, including a child omitted from an earlier snapshot', async () => {
    db.patch_resource.findMany.mockImplementation(async () => {
      expect(events).toContain('patch-lock')
      return [resource, { ...resource, id: 11 }]
    })
    await deletePatchById({ patchId: 20 })
    expect(side.close).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ resourceIds: [10, 11] })
    )
    expect(
      db.patch_resource.delete.mock.calls.map(([args]) => args.where.id)
    ).toEqual([10, 11])
  })
})
