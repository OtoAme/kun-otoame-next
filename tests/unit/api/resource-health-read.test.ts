import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  patch_resource: { findMany: vi.fn(), count: vi.fn() },
  patch_resource_access_grant: { findMany: vi.fn() },
  patch_resource_access: { findMany: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({
  getPublicResourceCaseBadges: vi.fn(async () => new Map())
}))
import { getPatchResource } from '~/app/api/patch/resource/get'
import { getPatchResource as getAdminResource } from '~/app/api/admin/resource/get'
import { getPatchResourceApply } from '~/app/api/admin/resource-apply/get'

const link = (id = 3, health = 'ok') => ({
  id,
  version: 2,
  evidence_round: 0,
  health,
  health_changed_at: null,
  verified_at: null,
  content_changed_at: null,
  reports: [],
  check: null,
  storage: 'user',
  content: 'https://example.test/share',
  code: 'private-code',
  password: 'private-password',
  hash: '',
  size: '1 GB',
  sort_order: 0,
  download: 0
})
const resource = (id = 2, health = 'ok') => ({
  id,
  name: 'Resource',
  section: 'galgame',
  type: ['pc'],
  language: ['ja'],
  platform: ['windows'],
  note: '',
  download: 0,
  status: 0,
  user_id: 7,
  patch_id: 1,
  created: new Date('2026-10-09T00:00:00Z'),
  patch: { unique_id: 'abcdefgh', name: 'Game' },
  user: {
    id: 7,
    name: 'Author',
    avatar: '',
    role: 1,
    _count: { patch_resource: 1 }
  },
  _count: { like_by: 0 },
  like_by: [],
  links: [link(id + 1, health)]
})
beforeEach(() => {
  vi.clearAllMocks()
  db.patch_resource.findMany.mockResolvedValue([resource()])
  db.patch_resource.count.mockResolvedValue(1)
  db.patch_resource_access_grant.findMany.mockResolvedValue([
    { resource_id: 2, expires: new Date('2099-01-01T00:00:00Z') }
  ])
  db.patch_resource_access.findMany.mockResolvedValue([])
})

describe('current-version resource health reads', () => {
  it('returns exact hidden admin resource with authoritative edit base and credentials', async () => {
    db.patch_resource.findMany.mockResolvedValue([{ ...resource(), status: 1 }])
    const result = await getAdminResource(
      { page: 1, limit: 1, search: '', resourceId: 2, userId: undefined },
      {},
      { uid: 8, role: 3 }
    )
    expect(result.resources[0]).toMatchObject({
      id: 2,
      status: 1,
      baseLinks: [{ id: 3, version: 2 }],
      links: [{ content: 'https://example.test/share', code: 'private-code' }]
    })
    expect(db.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2, patch: {} } })
    )
  })
  it('separates resource authorization from current-version reveal and preserves broken public identities', async () => {
    db.patch_resource.findMany.mockResolvedValue([
      resource(2, 'broken'),
      resource(8)
    ])
    db.patch_resource_access.findMany.mockResolvedValue([
      { link_id: 3, link_version: 1 },
      { link_id: null, link_version: 2 }
    ])
    const result = await getPatchResource({ patchId: 1 }, { uid: 7, role: 1 })
    expect(result.map((row) => row.id)).toEqual([8, 2])
    expect(result[1].links[0]).toMatchObject({
      id: 3,
      health: 'broken',
      version: 2,
      obtained: true,
      revealed: false
    })
    for (const row of result)
      for (const item of row.links) {
        expect(item).not.toHaveProperty('content')
        expect(item).not.toHaveProperty('code')
        expect(item).not.toHaveProperty('password')
        expect(item).not.toHaveProperty('reports')
        expect(item).not.toHaveProperty('check')
      }
    db.patch_resource_access.findMany.mockResolvedValue([
      { link_id: 3, link_version: 2 }
    ])
    expect(
      (await getPatchResource({ patchId: 1 }, { uid: 7, role: 1 }))[1].links[0]
        .revealed
    ).toBe(true)
  })

  it.each([getAdminResource, getPatchResourceApply])(
    'returns private credentials with a complete same-read edit base and verified viewer capabilities',
    async (read) => {
      const input = { page: 1, limit: 20, search: '', userId: undefined }
      const result = await read(input, {}, { uid: 8, role: 3 })
      expect(result.resources[0].baseLinks).toEqual([{ id: 3, version: 2 }])
      expect(result.resources[0].links[0]).toMatchObject({
        content: 'https://example.test/share',
        code: 'private-code',
        version: 2,
        capabilities: { canCheck: true, canEdit: true, ownerActions: [] }
      })
      const conservative = await read(input, {})
      expect(conservative.resources[0].links[0].capabilities).toEqual({
        canCheck: false,
        canEdit: false,
        ownerActions: [],
        resolveActions: []
      })
    }
  )
})
