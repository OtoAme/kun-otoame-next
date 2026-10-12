import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const tx = {
    patch_resource_link: { findFirst: vi.fn() },
    patch_resource_access_grant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    patch_resource_access: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn()
    }
  }
  return {
    tx,
    patch_resource_link: { findFirst: vi.fn() },
    patch_resource_access_grant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    patch_resource_access: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn()
  }
})
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }))
import { resolveResourceAccessGrant } from '~/app/api/patch/resource/download/access/grant'
import { accessPatchResourceLink } from '~/app/api/patch/resource/download/access/service'
import { restorePatchResourceLinks } from '~/app/api/patch/resource/download/access/restore/service'

const now = new Date('2026-10-09T00:00:00Z')
const expires = new Date('2026-10-09T12:00:00Z')
const actor = {
  actorType: 'user' as const,
  uid: 7,
  visitorToken: '' as const,
  ipHash: '',
  shouldSetVisitorCookie: false as const
}
const target = {
  id: 3,
  version: 2,
  storage: 'user',
  size: '1 GB',
  content: 'https://example.test/new',
  code: 'new-code',
  password: '',
  hash: '',
  resource: { section: 'galgame' }
}
const input = {
  actor,
  patchId: 1,
  resourceId: 2,
  linkId: 3,
  section: 'galgame' as const,
  storage: 'stale-storage',
  now
}

beforeEach(() => {
  vi.resetAllMocks()
  db.$transaction.mockImplementation((callback) => callback(db.tx))
  db.tx.patch_resource_link.findFirst.mockResolvedValue(target)
  db.tx.patch_resource_access_grant.findUnique.mockResolvedValue({ expires })
  db.tx.patch_resource_access.findFirst.mockResolvedValue(null)
  db.tx.patch_resource_access.create.mockResolvedValue({ id: 9 })
  db.patch_resource_access_grant.findUnique.mockResolvedValue({ expires })
})

describe('resource address-version acquisition', () => {
  it('reveals a new version under the original grant without extending expiry or counting quota', async () => {
    const result = await resolveResourceAccessGrant(input)
    expect(result).toMatchObject({
      kind: 'link_revealed',
      expires,
      link: { version: 2, content: target.content }
    })
    expect(db.tx.patch_resource_access.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ link_id: 3, link_version: 2 })
      })
    )
    expect(db.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        access_kind: 'link_reveal',
        link_version: 2,
        storage: 'user',
        expires
      })
    })
    expect(db.tx.patch_resource_access_grant.update).not.toHaveBeenCalled()
    expect(db.tx.patch_resource_access_grant.create).not.toHaveBeenCalled()
    expect(db.tx.patch_resource_access.count).not.toHaveBeenCalled()
  })

  it('returns address and version from the event transaction instead of its earlier visibility precheck', async () => {
    const realNow = new Date()
    const currentExpires = new Date(realNow.getTime() + 60_000)
    db.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      expires: currentExpires
    })
    db.patch_resource_link.findFirst.mockResolvedValue({
      ...target,
      content: 'https://example.test/old',
      resource: { id: 2, patch_id: 1, section: 'galgame' }
    })
    const result = await accessPatchResourceLink(
      { patchId: 1, resourceId: 2, linkId: 3 },
      { content_limit: 'sfw' },
      actor
    )
    expect(result).toMatchObject({
      link: { version: 2, content: target.content, code: 'new-code' },
      access: { kind: 'link_revealed' }
    })
    expect(db.tx.patch_resource_link.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resource: expect.objectContaining({
            patch: expect.objectContaining({ content_limit: 'sfw' })
          })
        })
      })
    )
    expect(db.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link_version: 2,
        expires: currentExpires
      })
    })
  })

  it('reuses only current-version evidence and returns 404 if the target disappears before the transaction', async () => {
    db.tx.patch_resource_access.findFirst.mockResolvedValue({ id: 9 })
    expect(await resolveResourceAccessGrant(input)).toMatchObject({
      kind: 'reused',
      link: { version: 2 }
    })
    expect(db.tx.patch_resource_access.create).not.toHaveBeenCalled()
    db.patch_resource_link.findFirst.mockResolvedValue({
      ...target,
      resource: { id: 2, patch_id: 1, section: 'galgame' }
    })
    db.tx.patch_resource_link.findFirst.mockResolvedValue(null)
    expect(
      await accessPatchResourceLink(
        { patchId: 1, resourceId: 2, linkId: 3 },
        {},
        actor
      )
    ).toMatchObject({ status: 404 })
  })

  it('restores only matching live versions, ignoring unknown, older and removed links without any writes', async () => {
    const { resource: _resource, ...link } = target
    db.patch_resource_access.findMany.mockResolvedValue([
      { link_version: null, link },
      { link_version: 1, link },
      { link_version: 2, link: null },
      { link_version: 2, link }
    ])
    expect(
      await restorePatchResourceLinks(
        { patchId: 1, resourceId: 2, linkIds: [3] },
        {},
        actor,
        now
      )
    ).toEqual({ links: [link], obtainedExpiresAt: expires.toISOString() })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.patch_resource_access.create).not.toHaveBeenCalled()
    expect(db.patch_resource_access.update).not.toHaveBeenCalled()
    expect(db.patch_resource_access_grant.create).not.toHaveBeenCalled()
    expect(db.patch_resource_access_grant.update).not.toHaveBeenCalled()
  })
})
