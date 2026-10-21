import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  patch_resource: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  patch_resource_access_grant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn()
  },
  patch_resource_access: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn()
  }
}))
const downloads = vi.hoisted(() => ({
  access: vi.fn(),
  restore: vi.fn(),
  grant: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/patch/resource/download/access/service', () => ({
  accessPatchResourceLink: downloads.access
}))
vi.mock('~/app/api/patch/resource/download/access/restore/service', () => ({
  restorePatchResourceLinks: downloads.restore
}))
vi.mock('~/app/api/patch/resource/download/access/grant', () => ({
  resolveResourceAccessGrant: downloads.grant
}))
vi.mock('~/app/api/patch/resource/maintenance/read', () => ({
  resourceActionableMaintenanceCounts: async () => new Map(),
  getMaintenanceItem: async () => ({})
}))
vi.mock('~/app/api/patch/resource/update', () => ({
  updateWorkspacePatchResource: vi.fn()
}))
vi.mock('~/app/api/patch/resource/delete', () => ({ deleteResource: vi.fn() }))
vi.mock('~/app/api/patch/resource/linkHealthProjection', () => ({
  linkHealthSelect: () => ({}),
  getLinkDisputeSources: async () => new Map(),
  projectLinkHealth: (link: { version: number }) => ({ version: link.version })
}))
import {
  getWorkspaceResources,
  getWorkspaceResource
} from '~/app/api/workspace/resources/service'
const user = { id: 7, role: 2, name: 'user' }
const date = new Date('2026-10-19T00:00:00Z')
const link = (id: number, storage: string) => ({
  id,
  version: 1,
  storage,
  health: 'ok',
  maintenance_controls: [],
  content: 'synthetic',
  code: 'synthetic',
  password: 'synthetic',
  hash: 'synthetic',
  size: '1 GB',
  sort_order: id,
  download: 0
})
const row = () => ({
  id: 3,
  patch_id: 4,
  user_id: 7,
  name: 'resource',
  section: 'galgame',
  status: 0,
  created: date,
  patch: {
    unique_id: 'abc12345',
    name: 'game',
    banner: 'https://example.test/game-banner.avif'
  },
  note: 'private-resource-note',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  links: [link(8, 'user'), link(9, 'touchgal')]
})
beforeEach(() => {
  vi.resetAllMocks()
  db.patch_resource.findFirst.mockResolvedValue(row())
  db.patch_resource.findMany.mockResolvedValue([row()])
  db.patch_resource.count.mockResolvedValue(1)
})
afterEach(() => {
  for (const operation of [
    ...Object.values(downloads),
    ...Object.values(db.patch_resource_access_grant),
    ...Object.values(db.patch_resource_access)
  ]) {
    expect(operation).not.toHaveBeenCalled()
  }
})
describe('workspace resource privacy', () => {
  it('returns game banner and resource metadata while keeping the list summary safe', async () => {
    const source = {
      ...row(),
      participants: [{ user_id: 8, note: 'private-participant' }]
    }
    db.patch_resource.findMany.mockResolvedValue([source])
    const result = await getWorkspaceResources(
      { page: 1, limit: 20, status: 'all', section: 'all' },
      user
    )
    expect(result.items[0]).toMatchObject({
      patchBanner: source.patch.banner,
      type: ['pc', 'row'],
      language: ['ja'],
      platform: ['windows']
    })
    const read = db.patch_resource.findMany.mock.calls[0][0]
    expect(read.select).toMatchObject({
      type: true,
      language: true,
      platform: true,
      patch: { select: { banner: true } }
    })
    expect(read.select.links).toEqual({
      select: { storage: true, content: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }]
    })
    expect(result.items[0]?.linkDiskKinds).toEqual(['other'])
    for (const field of [
      'note',
      'links',
      'baseLinks',
      'content',
      'code',
      'password',
      'hash',
      'participants',
      'maintenance'
    ]) {
      expect(result.items[0]).not.toHaveProperty(field)
    }
    for (const secret of [
      source.note,
      source.links[0].content,
      source.participants[0].note
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret)
    }
  })
  it('classifies list link kinds without returning addresses', async () => {
    const source = row()
    source.links = [
      {
        ...link(8, 'user'),
        content: 'https://pan.baidu.com/s/1SYN'
      },
      {
        ...link(11, 'user'),
        content: 'https://pan.quark.cn/s/SYN'
      },
      {
        ...link(12, 'user'),
        content: 'https://pan.baidu.com/s/1AGAIN'
      },
      {
        ...link(9, 's3'),
        content: 'https://storage.example.test/object.zip'
      }
    ]
    db.patch_resource.findMany.mockResolvedValue([source])
    const result = await getWorkspaceResources(
      { page: 1, limit: 20, status: 'all', section: 'all' },
      user
    )
    expect(result.items[0]?.linkDiskKinds).toEqual(['baidu', 'quark', 'object'])
    const encoded = JSON.stringify(result)
    expect(encoded).not.toContain('pan.baidu.com')
    expect(encoded).not.toContain('pan.quark.cn')
    expect(encoded).not.toContain('storage.example.test')
  })
  it('uses the same metadata projection in resource details and lists', async () => {
    const list = await getWorkspaceResources(
      { page: 1, limit: 20, status: 'all', section: 'all' },
      user
    )
    const detail = await getWorkspaceResource(3, user)
    const metadata = {
      patchBanner: row().patch.banner,
      type: ['pc', 'row'],
      language: ['ja'],
      platform: ['windows']
    }
    expect(list.items[0]).toMatchObject(metadata)
    expect(detail).toMatchObject(metadata)
    expect(
      db.patch_resource.findFirst.mock.calls[0][0].include.patch.select
    ).toEqual(db.patch_resource.findMany.mock.calls[0][0].select.patch.select)
  })
  it.each([2, 4])(
    'restricts both lists and detail reads to the current account for role %s',
    async (role) => {
      const own = row()
      const other = { ...row(), id: 4, user_id: 8, name: 'other resource' }
      const records = [other, own]
      db.patch_resource.findMany.mockImplementation(async ({ where }) =>
        records.filter((record) => record.user_id === where.user_id)
      )
      db.patch_resource.count.mockImplementation(
        async ({ where }) =>
          records.filter((record) => record.user_id === where.user_id).length
      )
      db.patch_resource.findFirst.mockImplementation(
        async ({ where }) =>
          records.find(
            (record) =>
              record.id === where.id && record.user_id === where.user_id
          ) ?? null
      )
      const viewer = { ...user, role }
      const result = await getWorkspaceResources(
        { page: 1, limit: 20, status: 'all', section: 'all' },
        viewer
      )
      expect(result.items.map((item) => item.id)).toEqual([own.id])
      expect(result.total).toBe(1)
      expect(db.patch_resource.findMany.mock.calls[0][0].where).toEqual({
        user_id: user.id
      })
      expect(db.patch_resource.count.mock.calls[0][0].where).toEqual({
        user_id: user.id
      })
      expect(await getWorkspaceResource(own.id, viewer)).toMatchObject({
        id: own.id,
        patchBanner: own.patch.banner
      })
      await expect(
        getWorkspaceResource(other.id, viewer)
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it('filters in database and returns no credentials in list summaries', async () => {
    const result = await getWorkspaceResources(
      {
        page: 2,
        limit: 20,
        query: 'game',
        status: 'pending',
        section: 'galgame'
      },
      user
    )
    const read = db.patch_resource.findMany.mock.calls[0][0]
    expect(read).toMatchObject({
      where: { user_id: 7, status: 2, section: 'galgame' },
      skip: 20,
      take: 20,
      orderBy: [{ created: 'desc' }, { id: 'desc' }]
    })
    expect(db.patch_resource.count).toHaveBeenCalledWith({ where: read.where })
    expect(JSON.stringify(result)).not.toContain('synthetic')
  })
  it('returns four-field protected slots and full editable slots without issuing access', async () => {
    const result = await getWorkspaceResource(3, user)
    expect(db.patch_resource.findFirst.mock.calls[0][0].where).toEqual({
      id: 3,
      user_id: 7
    })
    expect(result.links[0]).toMatchObject({
      protected: false,
      content: 'synthetic'
    })
    expect(result.links[1]).toEqual({
      id: 9,
      version: 1,
      storage: 'touchgal',
      protected: true
    })
    expect(result.baseLinks).toEqual([
      { id: 8, version: 1 },
      { id: 9, version: 1 }
    ])
  })
  it.each([1, 2])(
    'returns no slot secrets for readonly status %s',
    async (status) => {
      db.patch_resource.findFirst.mockResolvedValue({ ...row(), status })
      const result = await getWorkspaceResource(3, user)
      expect(
        result.links.every(
          (item) => item.protected && Object.keys(item).length === 4
        )
      ).toBe(true)
      expect(result.capabilities).toMatchObject({
        canEdit: false,
        canUpload: false
      })
      expect(result).toMatchObject({
        patchBanner: row().patch.banner,
        type: ['pc', 'row'],
        language: ['ja'],
        platform: ['windows']
      })
      expect(JSON.stringify(result.links)).not.toContain('synthetic')
    }
  )
  it('refuses a resource outside the session owner scope', async () => {
    db.patch_resource.findFirst.mockResolvedValue(null)
    await expect(getWorkspaceResource(99, user)).rejects.toMatchObject({
      status: 404
    })
  })
})
