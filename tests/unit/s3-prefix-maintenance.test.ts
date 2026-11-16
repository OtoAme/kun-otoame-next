import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  send: vi.fn()
}))

vi.mock('dotenv/config', () => ({}))
vi.mock('@aws-sdk/client-s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-s3')>()),
  S3Client: vi.fn(function () {
    return { send: storage.send }
  })
}))
vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(function () {
      return { end: vi.fn(async () => undefined) }
    })
  }
}))
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn(function () {
    return {}
  })
}))
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function () {
    return { $disconnect: vi.fn(), $queryRaw: vi.fn(async () => []) }
  }),
  Prisma: {
    sql: vi.fn((strings, ...values) => ({ strings, values })),
    join: vi.fn((values) => values)
  }
}))
vi.mock('~/prisma/index', () => ({ prisma: { $disconnect: vi.fn() } }))
vi.mock('~/app/api/edit/galleryUpload', () => ({
  preparePatchGalleryThumbnail: vi.fn()
}))
vi.mock('~/app/api/patch-submission/assetCleanup', () => ({
  collectSubmissionAssetKeys: vi.fn(),
  takeDownSubmissionAssets: vi.fn()
}))
vi.mock('~/app/api/patch-submission/orphanCleanup', () => ({
  enqueueSubmissionOrphanCleanupJobs: vi.fn(),
  loadServingSubmissionAssetKeys: vi.fn(),
  processSubmissionOrphanCleanupJobs: vi.fn()
}))

import {
  buildConversationImageCleanupOptions,
  createConversationImageCleanupDependencies,
  runConversationImageCleanup
} from '~/scripts/cleanupConversationImages'
import { createSubmissionAssetCleanupDependencies } from '~/scripts/cleanupSubmissionAssets'
import {
  downloadGalleryOriginalFromS3,
  downloadGalleryOriginalFromS3WithinLimit
} from '~/scripts/galleryThumbnailBackfill'

const chatKey =
  'conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif'

beforeEach(() => {
  vi.clearAllMocks()
  storage.objects.clear()
  vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-a')
  storage.send.mockImplementation(async (command) => {
    const { Key, Prefix } = command.input
    switch (command.constructor.name) {
      case 'ListObjectsV2Command':
        return {
          Contents: [...storage.objects.keys()]
            .filter((key) => key.startsWith(Prefix))
            .map((key) => ({ Key: key, LastModified: new Date(0), Size: 5 }))
        }
      case 'DeleteObjectCommand':
        storage.objects.delete(Key)
        return {}
      case 'HeadObjectCommand':
        return { ContentLength: storage.objects.get(Key)?.length }
      case 'GetObjectCommand': {
        const body = storage.objects.get(Key)
        if (!body) throw new Error('NoSuchKey')
        return { Body: body, ContentLength: body.length }
      }
      default:
        throw new Error('Unexpected storage command')
    }
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('S3 prefixes in maintenance operations', () => {
  it.each(['', 'worktrees/wt-a'])(
    'cleans private chat objects only within the configured root %j',
    async (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      const ownKey = prefix ? `${prefix}/${chatKey}` : chatKey
      const otherKey = `worktrees/wt-ab/${chatKey}`
      storage.objects.set(ownKey, Buffer.from('own'))
      storage.objects.set(otherKey, Buffer.from('other'))
      const dependencies = await createConversationImageCleanupDependencies()

      const result = await runConversationImageCleanup(
        buildConversationImageCleanupOptions(['--apply', '--delay=0']),
        dependencies
      )

      expect(result.deleted).toBe(1)
      expect(result.candidates).toEqual([chatKey])
      expect(storage.objects.has(ownKey)).toBe(false)
      expect(storage.objects.get(otherKey)).toEqual(Buffer.from('other'))
      await dependencies.close()
    }
  )

  it('returns submission keys without the environment prefix for database reference checks', async () => {
    const key = 'patch-submission/1-a/banner/banner.avif'
    storage.objects.set(`worktrees/wt-a/${key}`, Buffer.from('own'))
    storage.objects.set(`worktrees/wt-ab/${key}`, Buffer.from('other'))
    storage.objects.set(key, Buffer.from('production'))
    const dependencies = await createSubmissionAssetCleanupDependencies()

    expect(await dependencies.listKeys()).toEqual([
      { key, lastModified: new Date(0) }
    ])
  })

  it('preserves pagination and excludes objects outside the selected environment', async () => {
    const first = 'patch-submission/1-a/banner/banner.avif'
    const second = 'patch-submission/2-b/banner/banner.avif'
    storage.send
      .mockResolvedValueOnce({
        Contents: [
          { Key: `worktrees/wt-a/${first}` },
          { Key: `worktrees/wt-ab/${first}` },
          { Key: first }
        ],
        NextContinuationToken: 'page-2'
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: `worktrees/wt-a/${second}` }]
      })
    const dependencies = await createSubmissionAssetCleanupDependencies()

    expect((await dependencies.listKeys()).map(({ key }) => key)).toEqual([
      first,
      second
    ])
    expect(storage.send.mock.calls.map(([command]) => command.input)).toEqual([
      expect.objectContaining({
        Prefix: 'worktrees/wt-a/patch-submission/',
        ContinuationToken: undefined
      }),
      expect.objectContaining({
        Prefix: 'worktrees/wt-a/patch-submission/',
        ContinuationToken: 'page-2'
      })
    ])
  })

  it.each(['', 'worktrees/wt-a'])(
    'reads gallery originals and retains the size guard with root %j',
    async (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      const key = 'patch/123/gallery/456.avif'
      const ownKey = prefix ? `${prefix}/${key}` : key
      storage.objects.set(ownKey, Buffer.from('original'))
      storage.objects.set(`worktrees/wt-b/${key}`, Buffer.from('other'))

      expect(await downloadGalleryOriginalFromS3(key)).toEqual(
        Buffer.from('original')
      )
      expect(await downloadGalleryOriginalFromS3WithinLimit(key, 8)).toEqual(
        Buffer.from('original')
      )
      await expect(
        downloadGalleryOriginalFromS3WithinLimit(key, 7)
      ).rejects.toThrow('original is too large')
    }
  )
})
