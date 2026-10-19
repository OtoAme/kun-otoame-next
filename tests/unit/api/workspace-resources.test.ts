import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  patch_resource: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
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
  patch: { unique_id: 'abc12345', name: 'game' },
  note: '',
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
describe('workspace resource privacy', () => {
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
    }
  )
  it('refuses a resource outside the session owner scope', async () => {
    db.patch_resource.findFirst.mockResolvedValue(null)
    await expect(getWorkspaceResource(99, user)).rejects.toMatchObject({
      status: 404
    })
  })
})
