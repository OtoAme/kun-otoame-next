import { describe, expect, it } from 'vitest'
import {
  locateResourceObjectKey,
  processResourceFileCleanup,
  queueResourceFileCleanup,
  ResourceFileCleanupError,
  type ResourceFileCleanupClient
} from '~/lib/resourceFileCleanup'

const hash = 'ab'.repeat(32)
const objectKey = `patch/12/resource/${hash}/file.zip`
const publicBase = 'https://cdn.example.test'
const content = `${publicBase}/${objectKey}`

type StoredCleanup = {
  id: number
  object_key: string
  resource_id: number
  status: string
  failure_category: string | null
  created: Date
  updated: Date
}

type FakeCleanupClient = {
  patch_resource_file_cleanup: {
    upsert(args: {
      where: { object_key: string }
      create: {
        object_key: string
        resource_id: number
        status: 'pending'
        failure_category: null
      }
      update: {
        resource_id: number
        status: 'pending'
        failure_category: null
      }
    }): Promise<StoredCleanup>
    findMany(args: {
      where: {
        id?: { in: number[] }
        OR: Array<
          | { status: 'pending' }
          | {
              status: 'failed'
              failure_category: { in: readonly string[] }
            }
        >
      }
      take: number
    }): Promise<StoredCleanup[]>
    updateMany(args: {
      where: { id: number; updated: Date }
      data: { status: string; failure_category: string | null }
    }): Promise<{ count: number }>
  }
  patch_resource_link: {
    findMany(): Promise<Array<{ id: number; content: string }>>
  }
}

const asCleanup = (client: FakeCleanupClient) =>
  client as unknown as ResourceFileCleanupClient

const createClient = (references: string[] = []) => {
  const rows: StoredCleanup[] = []
  let nextId = 1
  const deleted: string[] = []
  const logs: unknown[] = []
  const client: FakeCleanupClient = {
    patch_resource_file_cleanup: {
      async upsert({ where, create, update }) {
        const existing = rows.find((row) => row.object_key === where.object_key)
        if (existing) {
          existing.resource_id = update.resource_id
          existing.status = update.status
          existing.failure_category = update.failure_category
          existing.updated = new Date()
          return {
            ...existing,
            updated: new Date(existing.updated)
          }
        }
        const row: StoredCleanup = {
          id: nextId,
          object_key: create.object_key,
          resource_id: create.resource_id,
          status: create.status,
          failure_category: create.failure_category,
          created: new Date(nextId),
          updated: new Date(nextId)
        }
        nextId += 1
        rows.push(row)
        return row
      },
      async findMany({ where, take }) {
        return rows
          .filter((row) => {
            if (where.id && !where.id.in.includes(row.id)) return false
            return where.OR.some((choice) => {
              if (choice.status === 'pending') return row.status === 'pending'
              return (
                row.status === 'failed' &&
                choice.failure_category.in.includes(
                  row.failure_category as 'reference_query_failed' | 'delete_failed'
                )
              )
            })
          })
          .sort((left, right) => left.id - right.id)
          .slice(0, take)
          .map((row) => ({ ...row, updated: new Date(row.updated) }))
      },
      async updateMany({ where, data }) {
        const row = rows.find((item) => item.id === where.id)
        if (!row || row.updated.getTime() !== where.updated.getTime()) {
          return { count: 0 }
        }
        row.status = data.status
        row.failure_category = data.failure_category
        row.updated = new Date()
        return { count: 1 }
      }
    },
    patch_resource_link: {
      async findMany() {
        return references.map((value, index) => ({ id: index + 1, content: value }))
      }
    }
  }
  return { client, rows, deleted, logs }
}

describe('resource object key location', () => {
  it('keeps the storage key and drops signed queries and secrets', () => {
    expect(locateResourceObjectKey(objectKey, [])).toBe(objectKey)
    expect(
      locateResourceObjectKey(`${content}?token=secret-token#fragment`, [publicBase])
    ).toBe(objectKey)
    expect(
      locateResourceObjectKey('https://user:secret-token@cdn.example.test/patch/1/x', [])
    ).toBeNull()
    expect(locateResourceObjectKey(`patch/12/resource/${hash}/../file.zip`, [])).toBeNull()
    expect(locateResourceObjectKey(`patch/12/resource/${hash}/notes..zip`, [])).toBe(
      `patch/12/resource/${hash}/notes..zip`
    )
    expect(
      locateResourceObjectKey(
        `  https://CDN.example.test/patch/12/resource/${hash}/fi%6ce.zip?token=secret-token#fragment  `,
        [publicBase]
      )
    ).toBe(objectKey)
    expect(
      locateResourceObjectKey(`patch/12/resource/${hash}/fi%6Ce.zip`, [])
    ).toBe(objectKey)
    expect(
      locateResourceObjectKey(`https://evil.example.test/${objectKey}?token=secret-token`, [
        publicBase
      ])
    ).toBeNull()
    const spaced = `patch/12/resource/${hash}/my file.zip`
    const encodedSpaced = `${publicBase}/${spaced
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}?token=secret-token`
    expect(locateResourceObjectKey(encodedSpaced, [publicBase])).toBe(spaced)
    const encoded = `${publicBase}/${objectKey}?token=secret-token`
    expect(locateResourceObjectKey(encoded, [publicBase, 'https://old.example.test'])).toBe(
      objectKey
    )
    expect(
      locateResourceObjectKey(
        `https://old.example.test/${objectKey}?token=secret-token`,
        [publicBase, 'https://old.example.test']
      )
    ).toBe(objectKey)
  })
})

describe('queueResourceFileCleanup', () => {
  it('registers one pending credential per object and ignores non-s3 links', async () => {
    const { client, rows } = createClient()
    const first = await queueResourceFileCleanup(asCleanup(client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [
        { storage: 'user', content: 'https://disk.example/share?password=secret-token' },
        { storage: 'touchgal', content },
        { storage: 's3', content },
        { storage: 's3', content }
      ]
    })
    expect(first.jobIds).toEqual([1])
    expect(rows).toEqual([
      expect.objectContaining({
        object_key: objectKey,
        resource_id: 12,
        status: 'pending',
        failure_category: null
      })
    ])
    expect(JSON.stringify(rows)).not.toContain('secret-token')

    rows[0].status = 'cancelled'
    rows[0].failure_category = 'delete_failed'
    const second = await queueResourceFileCleanup(asCleanup(client), {
      resourceId: 13,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    expect(second.jobIds).toEqual([1])
    expect(rows[0]).toMatchObject({
      resource_id: 13,
      status: 'pending',
      failure_category: null
    })
  })

  it('writes nothing when an s3 link has no resource object key', async () => {
    const { client, rows } = createClient()
    await expect(
      queueResourceFileCleanup(asCleanup(client), {
        resourceId: 12,
        publicBases: [publicBase],
        links: [
          { storage: 's3', content },
          { storage: 's3', content: 'https://cdn.example.test/other/file.zip' }
        ]
      })
    ).rejects.toMatchObject({ code: 'invalid_locator' })
    expect(rows).toEqual([])
    await expect(
      queueResourceFileCleanup(asCleanup(client), {
        resourceId: 0,
        links: [{ storage: 's3', content }]
      })
    ).rejects.toBeInstanceOf(ResourceFileCleanupError)
  })
})

describe('processResourceFileCleanup', () => {
  it('cancels a shared object, retains delete failures, and completes an unused object', async () => {
    const shared = createClient([content])
    await queueResourceFileCleanup(asCleanup(shared.client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    const sharedReport = await processResourceFileCleanup(asCleanup(shared.client), {
      ids: [1],
      publicBases: [publicBase],
      deleteObject: async (key) => {
        shared.deleted.push(key)
        return 'deleted'
      },
      log: (event) => shared.logs.push(event)
    })
    expect(sharedReport).toMatchObject({ examined: 1, cancelled: 1, completed: 0 })
    expect(shared.deleted).toEqual([])
    expect(shared.rows[0].status).toBe('cancelled')

    const failing = createClient()
    await queueResourceFileCleanup(asCleanup(failing.client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    const failure = await processResourceFileCleanup(asCleanup(failing.client), {
      deleteObject: async (key) => {
        throw new Error(`provider failed ${key} secret-token`)
      },
      log: (event) => failing.logs.push(event)
    })
    expect(failure.failed).toBe(1)
    expect(failing.rows[0]).toMatchObject({
      status: 'failed',
      failure_category: 'delete_failed'
    })
    expect(JSON.stringify(failing.logs)).not.toContain('secret-token')
    expect(JSON.stringify(failing.logs)).not.toContain(objectKey)
    expect(JSON.stringify(failing.rows)).not.toContain('secret-token')

    const replay = await processResourceFileCleanup(asCleanup(failing.client), {
      deleteObject: async () => 'absent',
      log: (event) => failing.logs.push(event)
    })
    expect(replay.completed).toBe(1)
    expect(failing.rows[0].status).toBe('completed')

    const done = await processResourceFileCleanup(asCleanup(failing.client), {
      deleteObject: async () => {
        throw new Error('should not replay a completed row')
      }
    })
    expect(done.examined).toBe(0)
  })

  it('keeps a referenced-after-delete credential out of automatic replay', async () => {
    let checks = 0
    const { client, rows, deleted } = createClient()
    client.patch_resource_link.findMany = async () => {
      checks += 1
      return checks === 1 ? [] : [{ id: 90, content: objectKey }]
    }
    await queueResourceFileCleanup(asCleanup(client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    const report = await processResourceFileCleanup(asCleanup(client), {
      deleteObject: async (key) => {
        deleted.push(key)
        return 'deleted'
      }
    })
    expect(report.failed).toBe(1)
    expect(deleted).toEqual([objectKey])
    expect(rows[0]).toMatchObject({
      status: 'failed',
      failure_category: 'referenced_after_delete'
    })
    const replay = await processResourceFileCleanup(asCleanup(client), {
      deleteObject: async () => {
        throw new Error('should not delete again')
      }
    })
    expect(replay.examined).toBe(0)
  })

  it('does not delete while a mixed percent-encoding still locates to the same key', async () => {
    const mixed = `  https://CDN.example.test/patch/12/resource/${hash}/fi%6ce.zip?token=secret-token  `
    const { client, deleted } = createClient([mixed])
    await queueResourceFileCleanup(asCleanup(client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content: objectKey }]
    })
    const report = await processResourceFileCleanup(asCleanup(client), {
      publicBases: [publicBase],
      deleteObject: async (key) => {
        deleted.push(key)
        return 'deleted'
      }
    })
    expect(report.cancelled).toBe(1)
    expect(deleted).toEqual([])
    expect(JSON.stringify(report)).not.toContain('secret-token')
  })

  it('does not delete while a signed url or a near-miss name still has to be checked', async () => {
    const signed = `${content}?token=secret-token`
    const nearMiss = `${content}-extra`
    const signedClient = createClient([signed])
    await queueResourceFileCleanup(asCleanup(signedClient.client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    const signedReport = await processResourceFileCleanup(asCleanup(signedClient.client), {
      publicBases: [publicBase],
      deleteObject: async (key) => {
        signedClient.deleted.push(key)
        return 'deleted'
      }
    })
    expect(signedReport.cancelled).toBe(1)
    expect(signedClient.deleted).toEqual([])
    expect(JSON.stringify(signedClient.logs)).not.toContain('secret-token')
    expect(JSON.stringify(signedClient.logs)).not.toContain(objectKey)

    const extra = createClient([nearMiss])
    await queueResourceFileCleanup(asCleanup(extra.client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    const extraReport = await processResourceFileCleanup(asCleanup(extra.client), {
      publicBases: [publicBase],
      deleteObject: async () => {
        extra.deleted.push(objectKey)
        return 'deleted'
      }
    })
    expect(extraReport.completed).toBe(1)
    expect(extra.deleted).toEqual([objectKey])
  })

  it('keeps a re-queued row pending when its updated time changes during delete', async () => {
    const { client, rows, deleted } = createClient()
    await queueResourceFileCleanup(asCleanup(client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content: objectKey }]
    })
    const report = await processResourceFileCleanup(asCleanup(client), {
      publicBases: [],
      deleteObject: async () => {
        rows[0].updated = new Date(rows[0].updated.getTime() + 1000)
        rows[0].status = 'pending'
        rows[0].failure_category = null
        return 'deleted'
      }
    })
    expect(deleted).toEqual([])
    expect(report.completed).toBe(0)
    expect(rows[0].status).toBe('pending')
  })

  it('retains the row when the reference query fails and does not delete', async () => {
    const { client, rows, deleted } = createClient()
    await queueResourceFileCleanup(asCleanup(client), {
      resourceId: 12,
      publicBases: [publicBase],
      links: [{ storage: 's3', content }]
    })
    client.patch_resource_link.findMany = async () => {
      throw new Error('database unavailable secret-token')
    }
    const report = await processResourceFileCleanup(asCleanup(client), {
      deleteObject: async (key) => {
        deleted.push(key)
        return 'deleted'
      }
    })
    expect(report.failed).toBe(1)
    expect(deleted).toEqual([])
    expect(rows[0].failure_category).toBe('reference_query_failed')
  })
})
