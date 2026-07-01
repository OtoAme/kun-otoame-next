import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildConversationImageCleanupOptions,
  createConversationImageCleanupDependencies,
  isCanonicalConversationImageKey,
  runConversationImageCleanup,
  type ConversationImageCleanupDependencies,
  type ConversationImageCleanupObject
} from '~/scripts/cleanupConversationImages'

const dependencyModuleMocks = vi.hoisted(() => {
  const queryRaw = vi.fn()
  const disconnect = vi.fn()
  const poolEnd = vi.fn().mockResolvedValue(undefined)
  const pool = vi.fn(function Pool() {
    return { end: poolEnd }
  })
  const prismaClient = vi.fn(function PrismaClient() {
    return {
      $disconnect: disconnect,
      $queryRaw: queryRaw
    }
  })
  const prismaPg = vi.fn(function PrismaPg() {
    return {}
  })
  const prisma = {
    join: vi.fn((values: unknown[]) => ({
      text: values
        .map((value) =>
          typeof value === 'object' && value && 'text' in value
            ? String((value as { text: string }).text)
            : String(value)
        )
        .join(', ')
    })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.reduce((text, part, index) => {
        const value = values[index]
        if (value === undefined) {
          return `${text}${part}`
        }
        const valueText =
          typeof value === 'object' && value && 'text' in value
            ? String((value as { text: string }).text)
            : String(value)
        return `${text}${part}${valueText}`
      }, '')
    }))
  }
  const s3Send = vi.fn()
  const deleteFileFromS3 = vi.fn()

  return {
    deleteFileFromS3,
    disconnect,
    pool,
    poolEnd,
    prisma,
    prismaClient,
    prismaPg,
    queryRaw,
    s3Send
  }
})

vi.mock('pg', () => ({
  default: { Pool: dependencyModuleMocks.pool },
  Pool: dependencyModuleMocks.pool
}))

vi.mock('@prisma/client', () => ({
  Prisma: dependencyModuleMocks.prisma,
  PrismaClient: dependencyModuleMocks.prismaClient
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: dependencyModuleMocks.prismaPg
}))

vi.mock('~/lib/s3', () => ({
  deleteFileFromS3: dependencyModuleMocks.deleteFileFromS3,
  s3: { send: dependencyModuleMocks.s3Send }
}))

const OLD_DATE = new Date('2026-06-30T00:00:00.000Z')
const NOW = new Date('2026-06-30T04:00:00.000Z')

const createObject = (
  overrides: Partial<ConversationImageCleanupObject> = {}
): ConversationImageCleanupObject => ({
  key: 'conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif',
  lastModified: OLD_DATE,
  size: 1024,
  ...overrides
})

const createDependencies = (
  objects: ConversationImageCleanupObject[] = []
): ConversationImageCleanupDependencies => ({
  listObjects: vi
    .fn()
    .mockResolvedValueOnce({ objects, nextContinuationToken: undefined }),
  findReferencedKeys: vi.fn().mockResolvedValue(new Set<string>()),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  now: vi.fn(() => NOW)
})

describe('conversation image cleanup options', () => {
  it('keeps dry-run read-only and gives apply a low production default', () => {
    expect(buildConversationImageCleanupOptions([])).toMatchObject({
      apply: false,
      prefix: 'conversation/',
      batchSize: 50,
      concurrency: 1,
      delayMs: 0,
      limit: 200,
      olderThanHours: 2
    })

    expect(buildConversationImageCleanupOptions(['--apply'])).toMatchObject({
      apply: true,
      prefix: 'conversation/',
      batchSize: 50,
      concurrency: 1,
      delayMs: 1000,
      limit: 100,
      olderThanHours: 2
    })
  })

  it('parses bounded production tuning arguments', () => {
    expect(
      buildConversationImageCleanupOptions([
        '--apply',
        '--limit=0',
        '--batch=500',
        '--concurrency=9',
        '--delay=250',
        '--older-than-hours=1',
        '--conversation-id=7',
        '--verbose'
      ])
    ).toMatchObject({
      apply: true,
      prefix: 'conversation/7/',
      limit: undefined,
      batchSize: 200,
      concurrency: 4,
      delayMs: 250,
      olderThanHours: 2,
      verbose: true
    })
  })
})

describe('conversation image cleanup planning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts only canonical private chat image keys', () => {
    expect(
      isCanonicalConversationImageKey(
        'conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif'
      )
    ).toBe(true)
    expect(isCanonicalConversationImageKey('conversation/5/avatar.avif')).toBe(
      false
    )
    expect(
      isCanonicalConversationImageKey(
        'patch/5/gallery/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif'
      )
    ).toBe(false)
  })

  it('dry-run reports only old unreferenced canonical objects as eligible without deleting', async () => {
    const oldUnreferenced = createObject()
    const referenced = createObject({
      key: 'conversation/5/1007-1782780000001-123e4567-e89b-12d3-a456-426614174001.avif'
    })
    const tooNew = createObject({
      key: 'conversation/5/1007-1782788400000-123e4567-e89b-12d3-a456-426614174002.avif',
      lastModified: new Date('2026-06-30T03:30:00.000Z')
    })
    const invalid = createObject({ key: 'conversation/5/not-canonical.avif' })
    const deps = createDependencies([
      oldUnreferenced,
      referenced,
      tooNew,
      invalid
    ])
    vi.mocked(deps.findReferencedKeys).mockResolvedValue(new Set([referenced.key]))

    const result = await runConversationImageCleanup(
      buildConversationImageCleanupOptions([]),
      deps
    )

    expect(result).toMatchObject({
      scanned: 4,
      eligible: 1,
      deleted: 0,
      referenced: 1,
      tooNew: 1,
      invalidKey: 1,
      failed: 0
    })
    expect(result.candidates).toEqual([oldUnreferenced.key])
    expect(deps.findReferencedKeys).toHaveBeenCalledWith([
      oldUnreferenced.key,
      referenced.key
    ])
    expect(deps.deleteObject).not.toHaveBeenCalled()
  })

  it('apply deletes only old unreferenced candidates and records failures', async () => {
    const deleted = createObject()
    const failed = createObject({
      key: 'conversation/5/1007-1782780000001-123e4567-e89b-12d3-a456-426614174001.avif'
    })
    const deps = createDependencies([deleted, failed])
    vi.mocked(deps.deleteObject)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('s3 unavailable'))

    const result = await runConversationImageCleanup(
      buildConversationImageCleanupOptions(['--apply', '--delay=0']),
      deps
    )

    expect(deps.deleteObject).toHaveBeenCalledWith(deleted.key)
    expect(deps.deleteObject).toHaveBeenCalledWith(failed.key)
    expect(result).toMatchObject({
      scanned: 2,
      eligible: 2,
      deleted: 1,
      failed: 1
    })
    expect(result.failures).toEqual([
      { key: failed.key, reason: 's3 unavailable' }
    ])
  })

  it('ignores tombstoned message rows when protecting referenced S3 keys', async () => {
    dependencyModuleMocks.queryRaw.mockResolvedValue([])

    const dependencies = await createConversationImageCleanupDependencies()
    await dependencies.findReferencedKeys([
      'conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif'
    ])

    const query = dependencyModuleMocks.queryRaw.mock.calls[0]?.[0] as
      | { text?: string }
      | undefined
    expect(query?.text).toContain('is_deleted = false')
    await dependencies.close()
  })
})
