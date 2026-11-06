import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    patch_resource_link: { findFirst: vi.fn() },
    patch_resource_access_grant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    patch_resource_access: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    }
  }
  return {
    tx,
    $transaction: vi.fn(),
    patch_resource_link: { findFirst: vi.fn() }
  }
})

const cacheMocks = vi.hoisted(() => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn(),
  setRealtimePatchDownloadStats: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn(async () => undefined)
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: cacheMocks.invalidatePatchContentCache,
  invalidatePatchListCaches: cacheMocks.invalidatePatchListCaches
}))
vi.mock('~/app/api/patch/views/buffer', () => ({
  setRealtimePatchDownloadStats: cacheMocks.setRealtimePatchDownloadStats
}))

import { accessPatchResourceLink } from '~/app/api/patch/resource/download/access/service'
import { resolveResourceAccessGrant } from '~/app/api/patch/resource/download/access/grant'

const sqlOf = (parts: unknown) => Array.from(parts as string[]).join(' ')
const now = new Date('2026-07-10T02:00:00.000Z')
const grantExpires = new Date('2026-07-11T02:00:00.000Z')
const user = {
  actorType: 'user' as const,
  uid: 7,
  visitorToken: '' as const,
  ipHash: '',
  shouldSetVisitorCookie: false as const
}
const linkRow = (version = 1) => ({
  id: 22,
  version,
  storage: 'user',
  size: '1 GB',
  content: 'https://example.test/current',
  code: 'code',
  password: 'secret',
  hash: '',
  resource: { section: 'galgame' as const }
})
const input = {
  actor: user,
  patchId: 7,
  resourceId: 11,
  linkId: 22,
  storage: 'user',
  section: 'galgame' as const,
  now,
  visibilityWhere: { content_limit: 'sfw' as const }
}

const conflict = (code: 'P2002' | 'P2034') =>
  new Prisma.PrismaClientKnownRequestError(`test ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client
  })

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(
    async (callback: (tx: typeof db.tx) => Promise<unknown>) => callback(db.tx)
  )
  db.tx.$queryRaw.mockResolvedValue([
    { id: 11, unique_id: 'patch-7', download: 4 }
  ])
  db.tx.$executeRaw.mockResolvedValue(1)
  db.tx.patch_resource_link.findFirst.mockResolvedValue(linkRow())
  db.tx.patch_resource_access_grant.findUnique.mockResolvedValue(null)
  db.tx.patch_resource_access_grant.create.mockImplementation(
    async ({ data }: { data: { expires: Date } }) => data
  )
  db.tx.patch_resource_access_grant.update.mockImplementation(
    async ({ data }: { data: { expires: Date } }) => ({
      actor_key: 'user:7',
      resource_id: 11,
      expires: data.expires
    })
  )
  db.tx.patch_resource_access.count.mockResolvedValue(0)
  db.tx.patch_resource_access.findFirst.mockResolvedValue(null)
  db.tx.patch_resource_access.create.mockResolvedValue({ id: 1 })
  db.patch_resource_link.findFirst.mockResolvedValue({
    ...linkRow(),
    resource: { id: 11, patch_id: 7, section: 'galgame' }
  })
  cacheMocks.invalidatePatchContentCache.mockResolvedValue(undefined)
  cacheMocks.invalidatePatchListCaches.mockResolvedValue(undefined)
  cacheMocks.setRealtimePatchDownloadStats.mockResolvedValue(undefined)
})

describe('official mirror access grant lock and expiry', () => {
  it('locks the resource and rereads visibility before counting or writing a grant', async () => {
    const order: string[] = []
    db.tx.$queryRaw.mockImplementation(async (parts) => {
      const sql = sqlOf(parts)
      order.push(sql.includes('UPDATE patch') ? 'count-patch' : 'lock-resource')
      return [{ id: 11, unique_id: 'patch-7', download: 5 }]
    })
    db.tx.$executeRaw.mockImplementation(async (parts) => {
      const sql = sqlOf(parts)
      order.push(
        sql.includes('patch_resource_link') ? 'count-link' : 'count-resource'
      )
      return 1
    })
    db.tx.patch_resource_link.findFirst.mockImplementation(async (args) => {
      order.push('reread-link')
      expect(args.where.resource.patch).toMatchObject({
        id: 7,
        status: 0,
        content_limit: 'sfw'
      })
      return linkRow()
    })
    db.tx.patch_resource_access_grant.findUnique.mockImplementation(
      async () => {
        order.push('read-grant')
        return null
      }
    )
    db.tx.patch_resource_access_grant.create.mockImplementation(
      async ({ data }) => {
        order.push('write-grant')
        return data
      }
    )
    db.tx.patch_resource_access.create.mockImplementation(async () => {
      order.push('write-event')
      return { id: 1 }
    })

    const result = await resolveResourceAccessGrant(input)

    expect(result).toMatchObject({ kind: 'resource_granted' })
    expect(order).toEqual([
      'lock-resource',
      'reread-link',
      'read-grant',
      'count-resource',
      'count-link',
      'count-patch',
      'write-grant',
      'write-event'
    ])
    expect(sqlOf(db.tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE')
    expect(sqlOf(db.tx.$queryRaw.mock.calls[0][0])).not.toContain(
      'patch_resource_access_grant'
    )
  })

  it('does not reuse a live event when the resource grant is missing or expired', async () => {
    db.tx.patch_resource_access.findFirst.mockResolvedValue({
      expires: new Date('2026-07-10T18:00:00.000Z')
    })

    const missing = await resolveResourceAccessGrant(input)
    expect(missing).toMatchObject({ kind: 'resource_granted' })
    expect(db.tx.patch_resource_access.findFirst).not.toHaveBeenCalled()
    expect(db.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ access_kind: 'resource_grant' })
    })

    db.tx.patch_resource_access.create.mockClear()
    db.tx.patch_resource_access_grant.create.mockClear()
    db.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: 'user:7',
      resource_id: 11,
      expires: new Date('2026-07-10T01:00:00.000Z')
    })
    const expired = await resolveResourceAccessGrant(input)
    expect(expired).toMatchObject({ kind: 'resource_granted' })
    expect(db.tx.patch_resource_access.findFirst).not.toHaveBeenCalled()
    expect(db.tx.patch_resource_access_grant.update).toHaveBeenCalled()
    expect(db.tx.patch_resource_access_grant.create).not.toHaveBeenCalled()
  })

  it('does not revive an older link version or an already expired event', async () => {
    db.tx.patch_resource_link.findFirst.mockResolvedValue(linkRow(4))
    db.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: 'user:7',
      resource_id: 11,
      expires: grantExpires
    })
    db.tx.patch_resource_access.findFirst.mockImplementation(
      async ({ where }) => {
        expect(where.link_version).toBe(4)
        expect(where.expires).toEqual({ gt: now })
        return null
      }
    )

    const replaced = await resolveResourceAccessGrant(input)
    expect(replaced).toMatchObject({
      kind: 'link_revealed',
      revealedExpiresAt: grantExpires
    })
    expect(db.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        access_kind: 'link_reveal',
        link_version: 4,
        expires: grantExpires
      })
    })
    expect(db.tx.patch_resource_access.update).not.toHaveBeenCalled()
    const counted = db.tx.$executeRaw.mock.calls.map((call) => sqlOf(call[0]))
    expect(counted.some((sql) => sql.includes('patch_resource_link'))).toBe(
      true
    )
    expect(
      counted.some(
        (sql) =>
          sql.includes('UPDATE patch_resource') &&
          !sql.includes('patch_resource_link')
      )
    ).toBe(false)

    db.tx.patch_resource_access.create.mockClear()
    db.tx.patch_resource_link.findFirst.mockResolvedValue(linkRow(1))
    db.tx.patch_resource_access.findFirst.mockReset()
    db.tx.patch_resource_access.findFirst.mockResolvedValue({
      expires: new Date('2026-07-09T00:00:00.000Z')
    })
    const stale = await resolveResourceAccessGrant(input)
    expect(stale).toMatchObject({ kind: 'link_revealed' })
    expect(db.tx.patch_resource_access.create).toHaveBeenCalledTimes(1)
    expect(db.tx.patch_resource_access.update).not.toHaveBeenCalled()
  })

  it('keeps one committed count when a serialization conflict discards the first attempt', async () => {
    const committed = { resource: 0, link: 0, patch: 0 }
    let draft = { ...committed }
    let attempt = 0
    db.tx.$executeRaw.mockImplementation(async (parts) => {
      const sql = sqlOf(parts)
      if (sql.includes('patch_resource_link')) draft.link += 1
      else draft.resource += 1
      return 1
    })
    db.tx.$queryRaw.mockImplementation(async (parts) => {
      const sql = sqlOf(parts)
      if (sql.includes('UPDATE patch')) {
        draft.patch += 1
        return [{ unique_id: 'patch-7', download: draft.patch }]
      }
      return [{ id: 11, unique_id: 'patch-7', download: draft.patch }]
    })
    db.$transaction.mockImplementation(async (callback) => {
      draft = { ...committed }
      const result = await callback(db.tx)
      attempt += 1
      if (attempt === 1) throw conflict('P2034')
      Object.assign(committed, draft)
      return result
    })

    const result = await resolveResourceAccessGrant(input)

    expect(result).toMatchObject({
      kind: 'resource_granted',
      accounting: { download: 1, kind: 'resource_granted' }
    })
    expect(committed).toEqual({ resource: 1, link: 1, patch: 1 })
    expect(db.tx.$executeRaw.mock.calls.length).toBe(4)
  })

  it('uses a fresh now after a conflict so an expired grant is not reused', async () => {
    const before = new Date('2026-07-10T23:00:00.000Z')
    const after = new Date('2026-07-11T00:00:01.000Z')
    const liveGrant = new Date('2026-07-11T00:00:00.000Z')
    let tick = 0
    let attempt = 0
    db.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: 'user:7',
      resource_id: 11,
      expires: liveGrant
    })
    db.tx.patch_resource_access.findFirst.mockResolvedValue({
      expires: new Date('2026-07-11T00:00:00.500Z')
    })
    db.$transaction.mockImplementation(async (callback) => {
      const result = await callback(db.tx)
      attempt += 1
      if (attempt === 1) throw conflict('P2034')
      return result
    })

    const frozen = await resolveResourceAccessGrant({ ...input, now: before })
    expect(frozen).toMatchObject({ kind: 'reused' })

    attempt = 0
    db.tx.patch_resource_access_grant.update.mockClear()
    const moved = await resolveResourceAccessGrant({
      ...input,
      now: before,
      clock: () => (tick++ === 0 ? before : after)
    })
    expect(moved).toMatchObject({ kind: 'resource_granted' })
    expect(db.tx.patch_resource_access_grant.update).toHaveBeenCalled()
  })

  it('returns not_found without counting when the locked reread loses visibility', async () => {
    db.tx.patch_resource_link.findFirst.mockResolvedValue(null)

    await expect(resolveResourceAccessGrant(input)).resolves.toEqual({
      kind: 'not_found'
    })
    expect(db.tx.$queryRaw).toHaveBeenCalled()
    expect(db.tx.$executeRaw).not.toHaveBeenCalled()
    expect(db.tx.patch_resource_access.create).not.toHaveBeenCalled()
  })

  it('still returns the granted link when a post-commit cache step fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    cacheMocks.setRealtimePatchDownloadStats.mockRejectedValue(
      new Error('redis down')
    )

    const result = await accessPatchResourceLink(
      { patchId: 7, resourceId: 11, linkId: 22 },
      { content_limit: 'sfw' },
      user
    )

    expect(result).toMatchObject({
      link: {
        content: 'https://example.test/current',
        code: 'code',
        password: 'secret'
      },
      access: { kind: 'resource_granted' }
    })
    expect(error).toHaveBeenCalledWith(
      '[Resource] Postcommit operation failed',
      expect.objectContaining({
        operation: 'download-count:realtime-stats',
        uniqueId: 'patch-7',
        resourceId: 11,
        linkId: 22,
        kind: 'resource_granted',
        message: 'redis down'
      })
    )
    error.mockRestore()
  })
})
