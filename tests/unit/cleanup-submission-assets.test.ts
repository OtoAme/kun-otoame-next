import { describe, expect, it, vi } from 'vitest'
import {
  parseSubmissionAssetCleanupOptions,
  runSubmissionAssetCleanup,
  type SubmissionAssetCleanupDependencies
} from '~/scripts/cleanupSubmissionAssets'

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000)

const emptyJobResult = () => ({
  scanned: 0,
  done: 0,
  owed: 0,
  cancelled: 0,
  bookkeepingFailed: 0
})

const dependencies = (
  overrides: Partial<SubmissionAssetCleanupDependencies> = {}
): SubmissionAssetCleanupDependencies => ({
  listKeys: vi.fn().mockResolvedValue([]),
  loadServingKeys: vi.fn().mockResolvedValue(new Set<string>()),
  loadCleanupSubmissions: vi.fn().mockResolvedValue([]),
  loadOrphanJobKeys: vi.fn().mockResolvedValue([]),
  takeDownSubmission: vi.fn().mockResolvedValue({
    status: 'done',
    completed: true,
    keyCount: 0,
    deleteFailures: 0,
    purgeConfirmed: true
  }),
  enqueueOrphans: vi.fn().mockImplementation((keys) => Promise.resolve(keys)),
  processOrphanJobs: vi.fn().mockResolvedValue(emptyJobResult()),
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

describe('submission asset cleanup options', () => {
  it('defaults to a dry run', () => {
    const options = parseSubmissionAssetCleanupOptions([])
    expect(options.apply).toBe(false)
    expect(options.graceHours).toBe(24)
  })

  it('reads apply, grace and limit', () => {
    const options = parseSubmissionAssetCleanupOptions([
      '--apply',
      '--grace-hours',
      '6',
      '--limit',
      '10'
    ])
    expect(options).toEqual({ apply: true, graceHours: 6, limit: 10 })
  })

  it('ignores nonsense values instead of deleting on a bad flag', () => {
    const options = parseSubmissionAssetCleanupOptions([
      '--grace-hours',
      'soon',
      '--limit',
      '-5'
    ])
    expect(options.graceHours).toBe(24)
    expect(options.limit).toBeUndefined()
  })
})

describe('submission asset cleanup classification', () => {
  it('never enqueues an object a live submission or patch still serves', async () => {
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue([
        {
          key: 'patch-submission/1-abc/banner/banner.avif',
          lastModified: hoursAgo(72)
        },
        {
          key: 'patch-submission/9-zzz/gallery/1.avif',
          lastModified: hoursAgo(72)
        }
      ]),
      loadServingKeys: vi
        .fn()
        .mockResolvedValue(
          new Set(['patch-submission/1-abc/banner/banner.avif'])
        )
    })

    const result = await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24 },
      deps
    )

    expect(result.servingReferenced).toBe(1)
    expect(result.newOrphans).toEqual([
      'patch-submission/9-zzz/gallery/1.avif'
    ])
    expect(deps.enqueueOrphans).toHaveBeenCalledWith([
      'patch-submission/9-zzz/gallery/1.avif'
    ])
  })

  it('reports cleanup-row keys and existing jobs separately from new S3 orphans', async () => {
    const rowKey = 'patch-submission/1-row/banner/banner.avif'
    const jobKey = 'patch-submission/2-job/gallery/2.avif'
    const newKey = 'patch-submission/3-new/gallery/3.avif'
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue(
        [rowKey, jobKey, newKey].map((key) => ({
          key,
          lastModified: hoursAgo(72)
        }))
      ),
      loadCleanupSubmissions: vi
        .fn()
        .mockResolvedValue([{ id: 1, keys: [rowKey] }]),
      loadOrphanJobKeys: vi.fn().mockResolvedValue([jobKey])
    })

    const result = await runSubmissionAssetCleanup(
      { apply: false, graceHours: 24 },
      deps
    )

    expect(result.cleanupSubmissionIds).toEqual([1])
    expect(result.orphanJobKeys).toEqual([jobKey])
    expect(result.newOrphans).toEqual([newKey])
  })

  it('leaves recent objects alone because uploads have bytes before rows', async () => {
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue([
        {
          key: 'patch-submission/2-abc/gallery/1.avif',
          lastModified: hoursAgo(1)
        }
      ])
    })

    const result = await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24 },
      deps
    )

    expect(result.withinGrace).toBe(1)
    expect(result.newOrphans).toEqual([])
    expect(deps.enqueueOrphans).not.toHaveBeenCalled()
  })

  it('does not write jobs or run cleanup in dry-run mode', async () => {
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue([
        {
          key: 'patch-submission/3-abc/gallery/1.avif',
          lastModified: hoursAgo(72)
        }
      ]),
      loadCleanupSubmissions: vi
        .fn()
        .mockResolvedValue([{ id: 7, keys: [] }]),
      loadOrphanJobKeys: vi
        .fn()
        .mockResolvedValue(['patch-submission/old/job.avif'])
    })

    const result = await runSubmissionAssetCleanup(
      { apply: false, graceHours: 24 },
      deps
    )

    expect(result.newOrphans).toHaveLength(1)
    expect(deps.takeDownSubmission).not.toHaveBeenCalled()
    expect(deps.processOrphanJobs).not.toHaveBeenCalled()
    expect(deps.enqueueOrphans).not.toHaveBeenCalled()
  })
})

describe('submission asset cleanup apply priority', () => {
  it('spends the limit on cleanup rows before existing jobs or new orphans', async () => {
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue([
        {
          key: 'patch-submission/new/gallery/1.avif',
          lastModified: hoursAgo(72)
        }
      ]),
      loadCleanupSubmissions: vi
        .fn()
        .mockResolvedValue([{ id: 7, keys: [] }]),
      loadOrphanJobKeys: vi
        .fn()
        .mockResolvedValue(['patch-submission/old/job.avif'])
    })

    await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24, limit: 1 },
      deps
    )

    expect(deps.takeDownSubmission).toHaveBeenCalledWith(7)
    expect(deps.processOrphanJobs).not.toHaveBeenCalled()
    expect(deps.enqueueOrphans).not.toHaveBeenCalled()
  })

  it('processes persisted orphan jobs before enqueueing newly scanned orphans', async () => {
    const existingKey = 'patch-submission/old/job.avif'
    const newKey = 'patch-submission/new/gallery/1.avif'
    const processOrphanJobs = vi
      .fn()
      .mockResolvedValueOnce({ ...emptyJobResult(), scanned: 1, done: 1 })
      .mockResolvedValueOnce({ ...emptyJobResult(), scanned: 1, done: 1 })
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue([
        { key: newKey, lastModified: hoursAgo(72) }
      ]),
      loadOrphanJobKeys: vi
        .fn()
        .mockResolvedValueOnce([existingKey])
        .mockResolvedValueOnce([]),
      processOrphanJobs
    })

    await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24, limit: 2 },
      deps
    )

    expect(processOrphanJobs).toHaveBeenNthCalledWith(1, [existingKey])
    expect(deps.enqueueOrphans).toHaveBeenCalledWith([newKey])
    expect(processOrphanJobs).toHaveBeenNthCalledWith(2, [newKey])
    expect(
      processOrphanJobs.mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(deps.enqueueOrphans).mock.invocationCallOrder[0]
    )
  })

  it('honours the limit for newly discovered orphan jobs', async () => {
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue(
        Array.from({ length: 5 }, (_, index) => ({
          key: `patch-submission/5-abc/gallery/${index}.avif`,
          lastModified: hoursAgo(72)
        }))
      )
    })

    const result = await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24, limit: 2 },
      deps
    )

    expect(result.newOrphans).toHaveLength(2)
    expect(deps.enqueueOrphans).toHaveBeenCalledWith(result.newOrphans)
  })
})
