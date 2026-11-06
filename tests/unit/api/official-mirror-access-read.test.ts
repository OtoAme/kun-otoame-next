import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  patch_resource: { findMany: vi.fn() },
  patch_resource_access_grant: { findMany: vi.fn(), findUnique: vi.fn() },
  patch_resource_access: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({
  getPublicResourceCaseBadges: vi.fn(async () => new Map())
}))

import { getPatchResource } from '~/app/api/patch/resource/get'
import { restorePatchResourceLinks } from '~/app/api/patch/resource/download/access/restore/service'

const LIVE = new Date('2099-01-01T00:00:00.000Z')
const EARLIER = new Date('2098-01-01T00:00:00.000Z')
const DEAD = new Date('2020-01-01T00:00:00.000Z')
const NOW = new Date('2026-11-04T00:00:00.000Z')
const actor = {
  actorType: 'user' as const,
  uid: 7,
  visitorToken: '' as const,
  ipHash: '',
  shouldSetVisitorCookie: false as const
}

const link = (id = 3) => ({
  id,
  version: 2,
  evidence_round: 0,
  health: 'ok',
  health_changed_at: null,
  verified_at: null,
  content_changed_at: new Date('2026-10-02T00:00:00.000Z'),
  attached_at: new Date('2026-10-01T00:00:00.000Z'),
  reports: [],
  check: null,
  storage: 'touchgal',
  content: 'https://pan.example.test/secret',
  code: 'private-code',
  password: 'private-password',
  hash: '',
  size: '1 GB',
  sort_order: 0,
  download: 0
})

const resource = () => ({
  id: 2,
  name: 'Resource',
  section: 'galgame',
  type: ['pc'],
  language: ['ja'],
  platform: ['windows'],
  note: '',
  download: 3,
  status: 0,
  user_id: 7,
  patch_id: 1,
  created: new Date('2026-10-09T00:00:00.000Z'),
  publisher_left_at: new Date('2026-10-08T00:00:00.000Z'),
  patch: { unique_id: 'abcdefgh' },
  user: {
    id: 7,
    name: 'Author',
    avatar: '',
    role: 1,
    _count: { patch_resource: 1 }
  },
  _count: { like_by: 0 },
  like_by: [],
  links: [link()]
})

const sensitive = {
  id: 3,
  version: 2,
  storage: 'touchgal',
  size: '1 GB',
  content: 'https://pan.example.test/secret',
  code: 'private-code',
  password: 'private-password',
  hash: ''
}

beforeEach(() => {
  vi.clearAllMocks()
  db.patch_resource.findMany.mockResolvedValue([resource()])
  db.patch_resource_access_grant.findMany.mockResolvedValue([
    { resource_id: 2, expires: LIVE }
  ])
  db.patch_resource_access_grant.findUnique.mockResolvedValue({ expires: LIVE })
  db.patch_resource_access.findMany.mockResolvedValue([])
})

describe('official mirror public read and restore', () => {
  it('reveals only a current event under a still-live resource grant', async () => {
    db.patch_resource_access.findMany.mockResolvedValue([
      { resource_id: 2, link_id: 3, link_version: 1, expires: LIVE },
      { resource_id: 2, link_id: 3, link_version: 2, expires: EARLIER },
      { resource_id: 2, link_id: 3, link_version: 2, expires: LIVE },
      { resource_id: 2, link_id: 3, link_version: 2, expires: DEAD }
    ])

    const [row] = await getPatchResource({ patchId: 1 }, { uid: 7, role: 1 })

    expect(row.links[0]).toMatchObject({
      revealed: true,
      revealedExpiresAt: LIVE.toISOString(),
      obtained: true,
      obtainedExpiresAt: LIVE.toISOString(),
      backedUpAt: '2026-10-02T00:00:00.000Z'
    })
    expect(row).toMatchObject({
      publisherLeftAt: '2026-10-08T00:00:00.000Z',
      hasStaffBackup: true,
      backedUpAt: '2026-10-02T00:00:00.000Z',
      user: { role: 1 }
    })
    expect(JSON.stringify(row)).not.toContain('secret')
    expect(JSON.stringify(row)).not.toContain('private-code')
    expect(JSON.stringify(row)).not.toContain('private-password')
  })

  it('does not reveal a live event when the grant is missing or expired', async () => {
    db.patch_resource_access.findMany.mockResolvedValue([
      { resource_id: 2, link_id: 3, link_version: 2, expires: LIVE }
    ])
    db.patch_resource_access_grant.findMany.mockResolvedValue([])
    const missing = await getPatchResource({ patchId: 1 }, { uid: 7, role: 1 })
    expect(missing[0].links[0].revealed).toBe(false)
    expect(missing[0].links[0].revealedExpiresAt).toBeUndefined()
    expect(missing[0].links[0].obtained).not.toBe(true)

    db.patch_resource_access_grant.findMany.mockResolvedValue([
      { resource_id: 2, expires: DEAD }
    ])
    const expired = await getPatchResource({ patchId: 1 }, { uid: 7, role: 1 })
    expect(expired[0].links[0].revealed).toBe(false)
    expect(expired[0].links[0].revealedExpiresAt).toBeUndefined()
    expect(JSON.stringify(expired[0])).not.toContain('secret')
  })

  it('applies game visibility before returning a revealed resource', async () => {
    await getPatchResource({ patchId: 1 }, { uid: 7, role: 1 }, {
      content_limit: 'sfw'
    })

    expect(db.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          patch_id: 1,
          status: 0,
          patch: { id: 1, status: 0, content_limit: 'sfw' }
        }
      })
    )
  })

  it('restores nothing from a live event when the grant is missing, expired, old, or itself expired', async () => {
    const liveEvent = {
      link_version: 2,
      expires: LIVE,
      link: sensitive
    }
    db.patch_resource_access.findMany.mockResolvedValue([liveEvent])

    for (const grant of [null, { expires: NOW }, { expires: DEAD }]) {
      db.patch_resource_access.findMany.mockClear()
      db.patch_resource_access_grant.findUnique.mockResolvedValue(grant)
      const result = await restorePatchResourceLinks(
        { patchId: 1, resourceId: 2, linkIds: [3] },
        { content_limit: 'sfw' },
        actor,
        NOW
      )
      expect(result).toEqual({ links: [], obtainedExpiresAt: null })
      expect(db.patch_resource_access.findMany).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('secret')
    }

    db.patch_resource_access_grant.findUnique.mockResolvedValue({
      expires: LIVE
    })
    db.patch_resource_access.findMany.mockResolvedValue([
      { link_version: 1, expires: LIVE, link: sensitive },
      { link_version: 2, expires: DEAD, link: sensitive },
      {
        link_version: 2,
        expires: EARLIER,
        link: { ...sensitive, content: 'https://pan.example.test/kept' }
      }
    ])
    const restored = await restorePatchResourceLinks(
      { patchId: 1, resourceId: 2, linkIds: [3] },
      { content_limit: 'sfw' },
      actor,
      NOW
    )
    expect(restored.links).toEqual([
      {
        ...sensitive,
        content: 'https://pan.example.test/kept',
        revealedExpiresAt: EARLIER.toISOString()
      }
    ])
    expect(restored.obtainedExpiresAt).toBe(LIVE.toISOString())
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.patch_resource_access.create).not.toHaveBeenCalled()
    expect(db.patch_resource_access.update).not.toHaveBeenCalled()
    expect(db.patch_resource_access.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expires: { gt: NOW },
          resource: expect.objectContaining({
            patch: expect.objectContaining({ content_limit: 'sfw' })
          })
        })
      })
    )
  })
})
