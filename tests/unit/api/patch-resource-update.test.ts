import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  patch_resource: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn()
  },
  patch_resource_link: {
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn()
  },
  patch_resource_link_history: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn()
}))
const helpers = vi.hoisted(() => ({
  cleanupUploadedResourceDirs: vi.fn(),
  compensateUploadedResources: vi.fn(),
  deletePatchResourceCache: vi.fn(),
  deletePatchResourceLink: vi.fn(),
  finalizeUploadedResources: vi.fn(),
  releaseUploadedResourceLocks: vi.fn(),
  uploadPatchResource: vi.fn(),
  updatePatchAttributes: vi.fn()
}))
const closure = vi.hoisted(() => vi.fn())
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/patch/resource/_helper', () => helpers)
vi.mock('~/app/api/case/linkHealth', () => ({ closeLinkCases: closure }))
vi.mock('~/app/api/patch/resource/link-check/service', () => ({
  checkRelinkedResource: async (response: unknown) => response
}))
vi.mock('~/app/api/patch/resource/linkHealthProjection', async (original) => ({
  ...(await original<
    typeof import('~/app/api/patch/resource/linkHealthProjection')
  >()),
  getLinkDisputeSources: vi.fn(async () => new Map())
}))
import { updatePatchResource } from '~/app/api/patch/resource/update'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
const date = new Date('2026-10-09T00:00:00Z')
const makeLink = (id = 30, order = 0) => ({
  id,
  resource_id: 10,
  version: 1,
  evidence_round: 2,
  health: 'suspect',
  health_changed_at: date,
  verified_at: date,
  content_changed_at: null,
  storage: 'user',
  content: `https://example.test/${id}`,
  size: '1 GB',
  hash: '',
  code: '',
  password: '',
  sort_order: order,
  download: 9,
  created: date,
  updated: date,
  reports: [],
  check: null
})
const makeResource = () => ({
  id: 10,
  user_id: 3,
  patch_id: 20,
  section: 'galgame',
  name: '资源',
  note: '',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  status: 0,
  download: 9,
  created: date,
  patch: { name: '游戏', unique_id: 'abc12345' },
  user: {
    id: 3,
    name: '发布者',
    avatar: '',
    role: 2,
    _count: { patch_resource: 1 }
  },
  links: [makeLink()]
})
let resource: ReturnType<typeof makeResource>
let histories: unknown[]
let locks: string[]
const request = () => ({
  resourceId: 10,
  patchId: 20,
  baseLinks: resource.links.map((link) => ({
    id: link.id,
    version: link.version
  })),
  section: 'galgame' as const,
  name: '新资源名',
  note: '',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  links: resource.links.map(
    ({ id, storage, content, size, hash, code, password }) => ({
      id,
      storage,
      content,
      size,
      hash,
      code,
      password
    })
  )
})
beforeEach(() => {
  vi.resetAllMocks()
  resource = makeResource()
  histories = []
  locks = []
  db.patch_resource.findUnique.mockImplementation(async () =>
    structuredClone(resource)
  )
  db.patch_resource.findUniqueOrThrow.mockImplementation(async () =>
    structuredClone(resource)
  )
  db.patch_resource.update.mockImplementation(async ({ data }) => {
    Object.assign(resource, data)
    return resource
  })
  db.$queryRaw.mockImplementation(async (query) => {
    const sql = query.sql ?? ''
    locks.push(sql.includes('FROM patch_resource_link') ? 'links' : 'resource')
    return [{ id: 10 }]
  })
  db.patch_resource_link.create.mockImplementation(async ({ data }) => {
    const link = {
      ...makeLink(99, data.sort_order),
      ...data,
      health: 'ok',
      version: 1,
      evidence_round: 0,
      download: 0
    }
    resource.links.push(link)
    return link
  })
  db.patch_resource_link.updateMany.mockImplementation(
    async ({ where, data }) => {
      const row = resource.links.find(
        (link) => link.id === where.id && link.version === where.version
      )
      if (!row) return { count: 0 }
      Object.assign(row, data)
      return { count: 1 }
    }
  )
  db.patch_resource_link.deleteMany.mockImplementation(async ({ where }) => {
    const old = resource.links.length
    resource.links = resource.links.filter(
      (link) => !where.id.in.includes(link.id)
    )
    return { count: old - resource.links.length }
  })
  db.patch_resource_link_history.create.mockImplementation(async ({ data }) => {
    histories.push(data)
    return data
  })
  db.$transaction.mockImplementation(async (callback) => {
    const old = structuredClone(resource),
      oldHistory = [...histories]
    try {
      return await callback(db)
    } catch (error) {
      resource = old
      histories = oldHistory
      throw error
    }
  })
  helpers.updatePatchAttributes.mockResolvedValue('abc12345')
  db.patch_resource_link.count.mockResolvedValue(0)
  closure.mockResolvedValue({ closedCaseIds: [] })
  helpers.uploadPatchResource.mockResolvedValue({
    uploadId: '123e4567-e89b-42d3-a456-426614174000',
    consumeToken: 'synthetic',
    downloadLink: 'https://example.test/uploaded',
    hash: 'server-hash',
    size: '2 GB',
    s3Key: 'synthetic',
    localDir: '/synthetic'
  })
})
describe('stable resource edits', () => {
  it('allows ordinary removal before an unchanged protected slot without compacting its order', async () => {
    resource.links.push({ ...makeLink(31, 1), storage: 'touchgal' })
    const input = request()
    input.links = input.links.filter((link) => link.id === 31)
    expect(typeof (await updatePatchResource(input, 3, 2))).not.toBe('string')
    expect(resource.links).toMatchObject([
      { id: 31, sort_order: 1, version: 1, download: 9 }
    ])
  })
  it('preserves sparse sort values on metadata save and appends a new slot safely after them', async () => {
    resource.links[0].sort_order = 8
    resource.links.push(makeLink(31, 21))
    await updatePatchResource(request(), 3, 2)
    expect(resource.links.map((link) => link.sort_order)).toEqual([8, 21])
    expect(db.patch_resource_link.updateMany).not.toHaveBeenCalled()
    const input = request()
    const added = { ...input.links[0], content: 'https://example.test/new' }
    Reflect.deleteProperty(added, 'id')
    input.links.push(added)
    await updatePatchResource(input, 3, 2)
    expect(resource.links.map((link) => link.sort_order)).toEqual([8, 21, 22])
  })
  it('still refuses an explicit protected move when ordinary neighbors remain', async () => {
    resource.links.push({ ...makeLink(31, 1), storage: 'touchgal' })
    const input = request()
    input.links.reverse()
    expect(await updatePatchResource(input, 3, 2)).toBe(
      LINK_HEALTH_ERRORS.forbidden.message
    )
    expect(db.patch_resource.update).not.toHaveBeenCalled()
    expect(db.patch_resource_link.updateMany).not.toHaveBeenCalled()
  })
  it('refuses a sparse protected crossing even when array compaction retains its numeric sort value', async () => {
    resource.links[0].storage = 'touchgal'
    resource.links[0].sort_order = 1
    resource.links.push(makeLink(31, 21))
    const input = request()
    input.links.reverse()
    expect(await updatePatchResource(input, 3, 2)).toBe(
      LINK_HEALTH_ERRORS.forbidden.message
    )
    expect(db.patch_resource.update).not.toHaveBeenCalled()
    expect(db.patch_resource_link.updateMany).not.toHaveBeenCalled()
  })
  it('adds an ID-less slot without rewriting any existing slot or its counters', async () => {
    const input = request()
    const added = { ...input.links[0], content: 'https://example.test/added' }
    Reflect.deleteProperty(added, 'id')
    input.links.push(added)
    const result = await updatePatchResource(input, 3, 2)
    expect(
      resource.links.map((link) => [link.id, link.version, link.download])
    ).toEqual([
      [30, 1, 9],
      [99, 1, 0]
    ])
    expect(db.patch_resource_link.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resource_id: 10, sort_order: 1 })
    })
    expect(
      db.patch_resource_link.create.mock.calls[0][0].data
    ).not.toHaveProperty('id')
    expect(db.patch_resource_link.updateMany).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      links: [
        expect.objectContaining({ id: 30 }),
        expect.objectContaining({ id: 99, version: 1 })
      ]
    })
  })
  it('rejects foreign patch before upload/transaction', async () => {
    expect(await updatePatchResource({ ...request(), patchId: 99 }, 3, 3)).toBe(
      '资源不属于该 OtomeGame'
    )
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(helpers.uploadPatchResource).not.toHaveBeenCalled()
  })
  it('preserves slot health/version/counter/access identity for metadata and returns safe fresh data', async () => {
    const old = structuredClone(resource.links)
    const result = await updatePatchResource(request(), 3, 2)
    expect(resource.links).toEqual(old)
    expect(locks.slice(0, 2)).toEqual(['resource', 'links'])
    expect(db.patch_resource_link.updateMany).not.toHaveBeenCalled()
    expect(db.patch_resource_link.create).not.toHaveBeenCalled()
    expect(db.patch_resource_link.deleteMany).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      name: '新资源名',
      links: [{ id: 30, version: 1, health: 'suspect', download: 9 }],
      linkChecks: []
    })
    if (typeof result !== 'string')
      expect(result.links[0]).not.toHaveProperty('content')
  })
  it('reorders stable rows without stale counter writes', async () => {
    resource.links.push(makeLink(31, 1))
    const input = request()
    input.links.reverse()
    await updatePatchResource(input, 3, 2)
    expect(
      resource.links.map((link) => [
        link.id,
        link.version,
        link.sort_order,
        link.download
      ])
    ).toEqual([
      [30, 1, 1, 9],
      [31, 1, 0, 9]
    ])
    for (const [call] of db.patch_resource_link.updateMany.mock.calls)
      expect(call.data).not.toHaveProperty('download')
    expect(histories).toHaveLength(0)
    expect(closure).not.toHaveBeenCalled()
  })
  it.each(['missing', 'stale', 'duplicate', 'foreign', 'omitted_new_slot'])(
    'rejects %s base with zero writes',
    async (kind) => {
      const input = request()
      if (kind === 'missing') Reflect.deleteProperty(input, 'baseLinks')
      if (kind === 'stale') input.baseLinks[0].version = 99
      if (kind === 'duplicate') input.baseLinks.push({ ...input.baseLinks[0] })
      if (kind === 'foreign') input.links[0].id = 88
      if (kind === 'omitted_new_slot') resource.links.push(makeLink(31, 1))
      expect(typeof (await updatePatchResource(input, 3, 3))).toBe('string')
      expect(db.patch_resource.update).not.toHaveBeenCalled()
      expect(db.patch_resource_link.updateMany).not.toHaveBeenCalled()
      expect(histories).toHaveLength(0)
      expect(closure).not.toHaveBeenCalled()
    }
  )
  it('accepts legal removal from complete base and closes prior to deleting', async () => {
    resource.links.push(makeLink(31, 1))
    const input = request()
    input.links = input.links.filter((link) => link.id === 31)
    await updatePatchResource(input, 3, 2)
    expect(resource.links.map((link) => link.id)).toEqual([31])
    expect(histories).toEqual([
      expect.objectContaining({
        link_id: 30,
        reason: 'remove',
        from_version: 1
      })
    ])
    expect(closure).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        linkIds: [30],
        resolution: 'link_removed',
        actorType: 'publisher',
        actorId: 3
      })
    )
    expect(closure.mock.invocationCallOrder[0]).toBeLessThan(
      db.patch_resource_link.deleteMany.mock.invocationCallOrder[0]
    )
  })
  it('increments address version once and closes old cases; losing CAS rolls everything back', async () => {
    const input = request()
    input.links[0].content = 'https://example.test/new'
    await updatePatchResource(input, 3, 2)
    expect(resource.links[0]).toMatchObject({
      id: 30,
      version: 2,
      health: 'ok',
      evidence_round: 0,
      verified_at: null,
      download: 9
    })
    expect(histories).toHaveLength(1)
    expect(closure).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        targets: [{ linkId: 30, linkVersion: 1 }],
        resolution: 'relinked'
      })
    )
    resource = makeResource()
    histories = []
    vi.clearAllMocks()
    db.patch_resource_link.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await updatePatchResource(input, 3, 2)).toBe(
      LINK_HEALTH_ERRORS.resource_conflict.message
    )
    expect(resource.links[0].version).toBe(1)
    expect(histories).toHaveLength(0)
    expect(helpers.deletePatchResourceCache).not.toHaveBeenCalled()
  })
  it('keeps code-only changes on the same version; old touchgal slots cannot be changed, removed or reordered by publisher', async () => {
    const code = request()
    code.links[0].code = 'changed'
    await updatePatchResource(code, 3, 2)
    expect(resource.links[0].version).toBe(1)
    expect(histories).toHaveLength(0)
    resource = makeResource()
    resource.links[0].storage = 'touchgal'
    expect(typeof (await updatePatchResource(request(), 3, 2))).not.toBe(
      'string'
    )
    const change = request()
    change.links[0].storage = 'user'
    expect(await updatePatchResource(change, 3, 2)).toBe(
      LINK_HEALTH_ERRORS.forbidden.message
    )
    resource.links.push(makeLink(31, 1))
    const remove = request()
    remove.links = remove.links.filter((link) => link.id === 31)
    expect(await updatePatchResource(remove, 3, 2)).toBe(
      LINK_HEALTH_ERRORS.forbidden.message
    )
    const reorder = request()
    reorder.links.reverse()
    expect(await updatePatchResource(reorder, 3, 2)).toBe(
      LINK_HEALTH_ERRORS.forbidden.message
    )
  })
  it('preserves authoritative S3 data and compensates uploaded objects on DB failure', async () => {
    resource.links[0].storage = 's3'
    const input = request()
    Object.assign(input.links[0], {
      content: 'forged',
      hash: 'forged',
      size: '9 GB'
    })
    await updatePatchResource(input, 3, 3)
    expect(resource.links[0]).toMatchObject({
      content: 'https://example.test/30',
      hash: '',
      size: '1 GB',
      version: 1
    })
    const upload = request()
    Object.assign(upload.links[0], {
      uploadId: '123e4567-e89b-42d3-a456-426614174000'
    })
    db.patch_resource.update.mockRejectedValueOnce(new Error('db failed'))
    await expect(updatePatchResource(upload, 3, 3)).rejects.toThrow('db failed')
    expect(helpers.compensateUploadedResources).toHaveBeenCalledWith([
      expect.objectContaining({ hash: 'server-hash' })
    ])
  })
  it('includes admin callback in the save transaction and never compensates committed save for postcommit failures', async () => {
    const audit = vi.fn(async (tx) => {
      expect(tx).toBe(db)
    })
    helpers.finalizeUploadedResources.mockRejectedValue(new Error('finalize'))
    helpers.deletePatchResourceCache.mockRejectedValue(new Error('cache'))
    expect(
      typeof (await updatePatchResource(request(), 3, 3, { onSaved: audit }))
    ).not.toBe('string')
    expect(audit).toHaveBeenCalledOnce()
    expect(helpers.compensateUploadedResources).not.toHaveBeenCalled()
  })
  it('does not compensate a live content-addressed object when an uploaded replacement shares its address', async () => {
    resource.links[0].storage = 's3'
    const input = request()
    Object.assign(input.links[0], {
      uploadId: '123e4567-e89b-42d3-a456-426614174000'
    })
    db.patch_resource_link.count.mockResolvedValue(1)
    db.patch_resource.update.mockRejectedValue(new Error('db failed'))
    await expect(updatePatchResource(input, 3, 3)).rejects.toThrow('db failed')
    expect(helpers.compensateUploadedResources).toHaveBeenCalledWith([])
    expect(helpers.releaseUploadedResourceLocks).toHaveBeenCalled()
  })
  it('retries only the DB transaction after a serialization conflict without repeating upload or history', async () => {
    resource.links[0].storage = 's3'
    const input = request()
    Object.assign(input.links[0], {
      uploadId: '123e4567-e89b-42d3-a456-426614174000'
    })
    db.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('synthetic write conflict'), {
        name: 'DriverAdapterError',
        cause: { kind: 'TransactionWriteConflict', originalCode: '40001' }
      })
    )
    expect(typeof (await updatePatchResource(input, 3, 3))).not.toBe('string')
    expect(db.$transaction).toHaveBeenCalledTimes(2)
    expect(helpers.uploadPatchResource).toHaveBeenCalledOnce()
    expect(histories).toHaveLength(1)
    expect(helpers.compensateUploadedResources).not.toHaveBeenCalled()
  })
})
