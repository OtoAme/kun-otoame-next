import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('~/lib/officialMirror/cache', () => ({
  refreshAfterCommit: vi.fn(async () => true),
  refreshOfficialMirrorPresentation: vi.fn(async () => undefined)
}))

vi.mock('~/lib/redis', () => ({
  redis: { on: () => undefined },
  runRedisCommand: async (command: () => Promise<unknown>) => command(),
  getPrefixedRedisKey: (key: string) => key,
  getKv: async () => null,
  setKv: async () => undefined,
  delKv: async () => undefined,
  getOrSet: async (_key: string, load: () => Promise<unknown>) => load(),
  consumeUpload: async () => ({ ok: false, code: 'MISSING' }),
  finalizeUpload: async () => undefined,
  releaseUploadConsumeLock: async () => undefined,
  acquireKvLock: async () => true,
  releaseKvLock: async () => undefined
}))

vi.mock('~/lib/s3', () => ({
  s3: {
    send: async () => {
      throw new Error('isolated s3 stand-in')
    }
  },
  uploadFileToS3: async () => {
    throw new Error('isolated s3 stand-in')
  },
  deleteFileFromS3: async () => {
    throw new Error('isolated s3 stand-in')
  },
  cleanupLocalUpload: async () => undefined
}))

const databaseUrl = process.env.OFFICIAL_MIRROR_C_DATABASE_URL ?? ''

const assertDatabaseUrl = (value: string) => {
  const parsed = new URL(value)
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '55435' ||
    name !== 'official_mirror_c_e2e'
  ) {
    throw new Error(
      'Refusing to run outside postgresql://127.0.0.1:55435/official_mirror_c_e2e'
    )
  }
}

if (databaseUrl) {
  assertDatabaseUrl(databaseUrl)
  process.env.KUN_DATABASE_URL = databaseUrl
}

type GrantModule =
  typeof import('~/app/api/patch/resource/download/access/grant')
type MergeModule = typeof import('~/lib/officialMirror/mergeService')

const ids = {
  users: [] as number[],
  patches: [] as number[]
}
let prisma: PrismaClient
let grantApi: GrantModule
let mergeApi: MergeModule

const token = (bytes = 3) => randomBytes(bytes).toString('hex')

const deferred = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const errorShape = (error: unknown) => {
  if (!error || typeof error !== 'object') return { type: typeof error }
  const record = error as {
    name?: string
    code?: string
    meta?: {
      code?: unknown
      driverAdapterError?: {
        cause?: { originalCode?: unknown; kind?: unknown }
      }
    }
    cause?: { originalCode?: unknown; kind?: unknown }
  }
  return {
    name: record.name,
    code: record.code,
    metaCode: record.meta?.code,
    adapterCode: record.meta?.driverAdapterError?.cause?.originalCode,
    adapterKind: record.meta?.driverAdapterError?.cause?.kind,
    causeCode: record.cause?.originalCode,
    causeKind: record.cause?.kind
  }
}

describe.skipIf(!databaseUrl)(
  'official mirror C grant and merge on official_mirror_c_e2e',
  () => {
    beforeAll(async () => {
      const { Pool } = await import('pg')
      const pool = new Pool({ connectionString: databaseUrl, max: 1 })
      const identity = await pool.query<{
        db: string
        role: string
      }>('SELECT current_database() AS db, current_user AS role')
      await pool.end()
      expect(identity.rows[0]).toEqual({
        db: 'official_mirror_c_e2e',
        role: 'official_mirror_c'
      })

      prisma = (await import('~/prisma/index')).prisma
      const confirmed = await prisma.$queryRaw<[{ db: string }]>`
        SELECT current_database() AS db
      `
      if (confirmed[0]?.db !== 'official_mirror_c_e2e') {
        throw new Error('Prisma connected to an unexpected database')
      }
      grantApi = await import('~/app/api/patch/resource/download/access/grant')
      mergeApi = await import('~/lib/officialMirror/mergeService')
    }, 30000)

    afterAll(async () => {
      if (!prisma) return
      if (ids.patches.length) {
        await prisma.patch_resource_merge_record.deleteMany({
          where: { patch_id: { in: ids.patches } }
        })
        await prisma.patch.deleteMany({ where: { id: { in: ids.patches } } })
      }
      if (ids.users.length) {
        await prisma.admin_log.deleteMany({
          where: { user_id: { in: ids.users } }
        })
        await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
      }
      await prisma.$disconnect()
    })

    const userActor = (uid: number) => ({
      actorType: 'user' as const,
      uid,
      visitorToken: '' as const,
      ipHash: 'c-e2e',
      shouldSetVisitorCookie: false as const
    })

    const createUser = async (role: number) => {
      const name = `c${token()}`
      const user = await prisma.user.create({
        data: {
          name,
          email: `${name}@e2e.test`,
          password: 'c-e2e-only',
          role
        }
      })
      ids.users.push(user.id)
      return user
    }

    const seedPair = async () => {
      const publisher = await createUser(2)
      const staffUser = await createUser(3)
      const admin = await createUser(3)
      const actor = await createUser(1)
      const patch = await prisma.patch.create({
        data: {
          unique_id: token(4),
          name: 'c-e2e-patch',
          type: ['game'],
          language: ['zh'],
          platform: ['windows'],
          content_limit: 'sfw',
          user_id: publisher.id,
          download: 10
        }
      })
      ids.patches.push(patch.id)
      const userResource = await prisma.patch_resource.create({
        data: {
          section: 'galgame',
          name: 'user card',
          type: ['game'],
          language: ['zh'],
          platform: ['windows'],
          download: 5,
          status: 0,
          user_id: publisher.id,
          patch_id: patch.id,
          created: new Date('2026-10-01T00:00:00.000Z')
        }
      })
      const staffResource = await prisma.patch_resource.create({
        data: {
          section: 'galgame',
          name: 'staff card',
          type: ['game'],
          language: ['zh'],
          platform: ['windows'],
          download: 3,
          status: 0,
          user_id: staffUser.id,
          patch_id: patch.id,
          created: new Date('2026-10-02T00:00:00.000Z')
        }
      })
      const userLink = await prisma.patch_resource_link.create({
        data: {
          storage: 'user',
          content: 'https://pan.example.test/user',
          resource_id: userResource.id,
          download: 4,
          version: 1
        }
      })
      const staffLink = await prisma.patch_resource_link.create({
        data: {
          storage: 'touchgal',
          content: 'https://pan.example.test/staff',
          resource_id: staffResource.id,
          download: 2,
          version: 1
        }
      })
      return {
        actor,
        admin,
        patch,
        userResource,
        staffResource,
        userLink,
        staffLink
      }
    }

    const mergePair = async (input: {
      adminId: number
      userResourceId: number
      staffResourceId: number
    }) => {
      const preview = await mergeApi.previewResourceMerge({
        userResourceId: input.userResourceId,
        staffResourceId: input.staffResourceId
      })
      if (typeof preview === 'string' || !preview.canMerge) {
        throw new Error(
          typeof preview === 'string'
            ? preview
            : `merge blocked: ${preview.blocks.map((block) => block.code).join(',')}`
        )
      }
      const merged = await mergeApi.mergeStaffIntoUser(
        {
          userResourceId: input.userResourceId,
          staffResourceId: input.staffResourceId,
          basis: preview.basis,
          contentConfirmed: true
        },
        input.adminId,
        false
      )
      if (typeof merged === 'string') throw new Error(merged)
      return merged
    }

    const orphans = async (staffResourceId: number) => {
      const [resource, links, grants, events] = await Promise.all([
        prisma.patch_resource.count({ where: { id: staffResourceId } }),
        prisma.patch_resource_link.count({
          where: { resource_id: staffResourceId }
        }),
        prisma.patch_resource_access_grant.count({
          where: { resource_id: staffResourceId }
        }),
        prisma.patch_resource_access.count({
          where: { resource_id: staffResourceId }
        })
      ])
      return { resource, links, grants, events }
    }

    it('recognizes the Prisma wrapper of a real serializable conflict', async () => {
      const { patch, userResource } = await seedPair()
      const { Prisma } = await import('@prisma/client')
      const ready = deferred()
      const release = deferred()
      const first = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT download FROM patch_resource WHERE id = ${userResource.id}`
          ready.resolve()
          await release.promise
          await tx.$executeRaw`
            UPDATE patch_resource SET download = download + 1
            WHERE id = ${userResource.id}
          `
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000
        }
      )
      const second = prisma.$transaction(
        async (tx) => {
          await ready.promise
          await tx.$queryRaw`SELECT download FROM patch_resource WHERE id = ${userResource.id}`
          await tx.$executeRaw`
            UPDATE patch_resource SET download = download + 1
            WHERE id = ${userResource.id}
          `
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000
        }
      )
      setTimeout(() => release.resolve(), 200)
      const settled = await Promise.allSettled([first, second])
      const rejected = settled.find((item) => item.status === 'rejected')
      expect(
        rejected,
        `no serializable conflict: patch ${patch.id}`
      ).toBeDefined()
      if (!rejected || rejected.status !== 'rejected') return
      expect(
        grantApi.isRetryableGrantConflict(rejected.reason),
        JSON.stringify(errorShape(rejected.reason))
      ).toBe(true)
      expect(grantApi.isRetryableGrantConflict(new Error('ordinary'))).toBe(
        false
      )
    })

    it('keeps a first grant and a merge without losing counts or leaving the old card', async () => {
      const seeded = await seedPair()
      const [granted, merged] = await Promise.all([
        grantApi.resolveResourceAccessGrant({
          actor: userActor(seeded.actor.id),
          patchId: seeded.patch.id,
          resourceId: seeded.userResource.id,
          linkId: seeded.userLink.id,
          storage: 'user',
          section: 'galgame',
          now: new Date(),
          clock: () => new Date()
        }),
        mergePair({
          adminId: seeded.admin.id,
          userResourceId: seeded.userResource.id,
          staffResourceId: seeded.staffResource.id
        })
      ])

      expect(granted.kind).toBe('resource_granted')
      expect(merged.resourceId).toBe(seeded.userResource.id)
      if (granted.kind !== 'resource_granted') return
      const [resource, link, patch, grant, events, staffLink] =
        await Promise.all([
          prisma.patch_resource.findUniqueOrThrow({
            where: { id: seeded.userResource.id }
          }),
          prisma.patch_resource_link.findUniqueOrThrow({
            where: { id: seeded.userLink.id }
          }),
          prisma.patch.findUniqueOrThrow({ where: { id: seeded.patch.id } }),
          prisma.patch_resource_access_grant.findUniqueOrThrow({
            where: {
              actor_key_resource_id: {
                actor_key: `user:${seeded.actor.id}`,
                resource_id: seeded.userResource.id
              }
            }
          }),
          prisma.patch_resource_access.findMany({
            where: {
              resource_id: seeded.userResource.id,
              access_kind: 'resource_grant'
            }
          }),
          prisma.patch_resource_link.findUniqueOrThrow({
            where: { id: seeded.staffLink.id }
          })
        ])
      expect(resource.download).toBe(9)
      expect(link.download).toBe(5)
      expect(patch.download).toBe(11)
      expect(staffLink.resource_id).toBe(seeded.userResource.id)
      expect(staffLink.download).toBe(2)
      expect(events).toHaveLength(1)
      expect(events[0]?.expires.toISOString()).toBe(grant.expires.toISOString())
      expect(granted.expires.toISOString()).toBe(grant.expires.toISOString())
      expect(await orphans(seeded.staffResource.id)).toEqual({
        resource: 0,
        links: 0,
        grants: 0,
        events: 0
      })
    })

    it('counts only the link when a live grant reveals during a merge', async () => {
      const seeded = await seedPair()
      const grantExpires = new Date(Date.now() + 20 * 60 * 60 * 1000)
      await prisma.patch_resource_access_grant.create({
        data: {
          actor_key: `user:${seeded.actor.id}`,
          resource_id: seeded.userResource.id,
          expires: grantExpires
        }
      })
      const [granted] = await Promise.all([
        grantApi.resolveResourceAccessGrant({
          actor: userActor(seeded.actor.id),
          patchId: seeded.patch.id,
          resourceId: seeded.userResource.id,
          linkId: seeded.userLink.id,
          storage: 'user',
          section: 'galgame',
          now: new Date(),
          clock: () => new Date()
        }),
        mergePair({
          adminId: seeded.admin.id,
          userResourceId: seeded.userResource.id,
          staffResourceId: seeded.staffResource.id
        })
      ])
      expect(granted.kind).toBe('link_revealed')
      const [resource, link, patch, grant, events] = await Promise.all([
        prisma.patch_resource.findUniqueOrThrow({
          where: { id: seeded.userResource.id }
        }),
        prisma.patch_resource_link.findUniqueOrThrow({
          where: { id: seeded.userLink.id }
        }),
        prisma.patch.findUniqueOrThrow({ where: { id: seeded.patch.id } }),
        prisma.patch_resource_access_grant.findUniqueOrThrow({
          where: {
            actor_key_resource_id: {
              actor_key: `user:${seeded.actor.id}`,
              resource_id: seeded.userResource.id
            }
          }
        }),
        prisma.patch_resource_access.findMany({
          where: { resource_id: seeded.userResource.id }
        })
      ])
      expect(resource.download).toBe(8)
      expect(link.download).toBe(5)
      expect(patch.download).toBe(10)
      expect(grant.expires.toISOString()).toBe(grantExpires.toISOString())
      expect(events).toHaveLength(1)
      expect(events[0]?.access_kind).toBe('link_reveal')
      expect(events[0]?.expires.toISOString()).toBe(grantExpires.toISOString())
      expect(await orphans(seeded.staffResource.id)).toEqual({
        resource: 0,
        links: 0,
        grants: 0,
        events: 0
      })
    })

    it('does not count or rewrite a live reveal that is reused during a merge', async () => {
      const seeded = await seedPair()
      const grantExpires = new Date(Date.now() + 20 * 60 * 60 * 1000)
      const eventExpires = new Date(Date.now() + 60 * 60 * 1000)
      await prisma.patch_resource_access_grant.create({
        data: {
          actor_key: `user:${seeded.actor.id}`,
          resource_id: seeded.userResource.id,
          expires: grantExpires
        }
      })
      await prisma.patch_resource_access.create({
        data: {
          actor_type: 'user',
          user_id: seeded.actor.id,
          visitor_token: '',
          access_kind: 'link_reveal',
          section: 'galgame',
          storage: 'user',
          patch_id: seeded.patch.id,
          resource_id: seeded.userResource.id,
          link_id: seeded.userLink.id,
          link_version: 1,
          expires: eventExpires
        }
      })
      const [granted] = await Promise.all([
        grantApi.resolveResourceAccessGrant({
          actor: userActor(seeded.actor.id),
          patchId: seeded.patch.id,
          resourceId: seeded.userResource.id,
          linkId: seeded.userLink.id,
          storage: 'user',
          section: 'galgame',
          now: new Date(),
          clock: () => new Date()
        }),
        mergePair({
          adminId: seeded.admin.id,
          userResourceId: seeded.userResource.id,
          staffResourceId: seeded.staffResource.id
        })
      ])
      expect(granted.kind).toBe('reused')
      const [resource, link, patch, grant, events] = await Promise.all([
        prisma.patch_resource.findUniqueOrThrow({
          where: { id: seeded.userResource.id }
        }),
        prisma.patch_resource_link.findUniqueOrThrow({
          where: { id: seeded.userLink.id }
        }),
        prisma.patch.findUniqueOrThrow({ where: { id: seeded.patch.id } }),
        prisma.patch_resource_access_grant.findUniqueOrThrow({
          where: {
            actor_key_resource_id: {
              actor_key: `user:${seeded.actor.id}`,
              resource_id: seeded.userResource.id
            }
          }
        }),
        prisma.patch_resource_access.findMany({
          where: { link_id: seeded.userLink.id }
        })
      ])
      expect(resource.download).toBe(8)
      expect(link.download).toBe(4)
      expect(patch.download).toBe(10)
      expect(grant.expires.toISOString()).toBe(grantExpires.toISOString())
      expect(events).toHaveLength(1)
      expect(events[0]?.expires.toISOString()).toBe(eventExpires.toISOString())
      expect(await orphans(seeded.staffResource.id)).toEqual({
        resource: 0,
        links: 0,
        grants: 0,
        events: 0
      })
    })

    it('lets one visitor compete for the daily grant quota across resources', async () => {
      const publisher = await createUser(2)
      const patch = await prisma.patch.create({
        data: {
          unique_id: token(4),
          name: 'c-e2e-quota',
          type: ['game'],
          language: ['zh'],
          platform: ['windows'],
          content_limit: 'sfw',
          user_id: publisher.id
        }
      })
      ids.patches.push(patch.id)
      const resources = await Promise.all(
        Array.from({ length: 6 }, async () => {
          const resource = await prisma.patch_resource.create({
            data: {
              section: 'galgame',
              name: 'quota card',
              type: ['game'],
              language: ['zh'],
              platform: ['windows'],
              download: 0,
              status: 0,
              user_id: publisher.id,
              patch_id: patch.id
            }
          })
          const link = await prisma.patch_resource_link.create({
            data: {
              storage: 'user',
              content: 'https://pan.example.test/quota',
              resource_id: resource.id,
              download: 0,
              version: 1
            }
          })
          return { resource, link }
        })
      )
      const visitorToken = randomUUID()
      const actor = {
        actorType: 'visitor' as const,
        uid: 0 as const,
        visitorToken,
        ipHash: 'c-e2e',
        shouldSetVisitorCookie: false as const
      }
      const requestGrant = (target: (typeof resources)[number]) =>
        grantApi.resolveResourceAccessGrant({
          actor,
          patchId: patch.id,
          resourceId: target.resource.id,
          linkId: target.link.id,
          storage: 'user',
          section: 'galgame',
          now: new Date(),
          clock: () => new Date()
        })
      // Six serializable grants share one visitor quota. Three server retries
      // can still surface busy; only that error may be retried by the caller.
      let pending = resources.slice()
      const fulfilled: Awaited<ReturnType<typeof requestGrant>>[] = []
      const waves: Array<{ granted: number; limited: number; busy: number }> =
        []
      for (let round = 0; round < 8 && pending.length > 0; round += 1) {
        const settled = await Promise.allSettled(pending.map(requestGrant))
        const retry: typeof pending = []
        let granted = 0
        let limited = 0
        let busy = 0
        settled.forEach((item, index) => {
          if (item.status === 'fulfilled') {
            fulfilled.push(item.value)
            if (item.value.kind === 'resource_granted') granted += 1
            else if (item.value.kind === 'limited') limited += 1
            return
          }
          if (item.reason instanceof grantApi.ResourceAccessGrantBusyError) {
            busy += 1
            const target = pending[index]
            if (target) retry.push(target)
            return
          }
          throw new Error(
            `unexpected grant failure: ${JSON.stringify(errorShape(item.reason))}`
          )
        })
        waves.push({ granted, limited, busy })
        pending = retry
      }
      const granted = fulfilled.filter(
        (item) => item.kind === 'resource_granted'
      )
      const limited = fulfilled.filter((item) => item.kind === 'limited')
      const events = await prisma.patch_resource_access.count({
        where: {
          visitor_token: visitorToken,
          access_kind: 'resource_grant',
          patch_id: patch.id
        }
      })
      const downloads = await prisma.patch_resource.findMany({
        where: { patch_id: patch.id },
        select: { download: true }
      })
      expect(pending).toEqual([])
      expect(
        fulfilled.every(
          (item) => item.kind === 'resource_granted' || item.kind === 'limited'
        )
      ).toBe(true)
      expect({
        waves,
        granted: granted.length,
        limited: limited.length
      }).toMatchObject({
        granted: 5,
        limited: 1
      })
      expect(events).toBe(5)
      expect(downloads.reduce((sum, row) => sum + row.download, 0)).toBe(5)
      expect(downloads.every((row) => row.download <= 1)).toBe(true)
      expect(
        (await prisma.patch.findUniqueOrThrow({ where: { id: patch.id } }))
          .download
      ).toBe(5)
    })
  }
)
