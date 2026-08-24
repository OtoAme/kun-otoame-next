import { describe, expect, it, vi } from 'vitest'
import {
  parseSubmissionAssetCleanupOptions,
  runSubmissionAssetCleanup,
  type SubmissionAssetCleanupDependencies
} from '~/scripts/cleanupSubmissionAssets'

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000)

const dependencies = (
  overrides: Partial<SubmissionAssetCleanupDependencies> = {}
): SubmissionAssetCleanupDependencies => ({
  listKeys: vi.fn().mockResolvedValue([]),
  loadReferencedKeys: vi.fn().mockResolvedValue(new Set<string>()),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  purge: vi.fn().mockResolvedValue(undefined),
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

describe('submission asset cleanup', () => {
  it('never deletes an object something still references', async () => {
    const deps = dependencies({
      listKeys: vi.fn().mockResolvedValue([
        { key: 'patch-submission/1-abc/banner/banner.avif', lastModified: hoursAgo(72) },
        { key: 'patch-submission/9-zzz/gallery/1.avif', lastModified: hoursAgo(72) }
      ]),
      loadReferencedKeys: vi
        .fn()
        .mockResolvedValue(
          new Set(['patch-submission/1-abc/banner/banner.avif'])
        )
    })

    const result = await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24 },
      deps
    )

    expect(result.referenced).toBe(1)
    expect(result.orphans).toEqual(['patch-submission/9-zzz/gallery/1.avif'])
    expect(deps.deleteObject).toHaveBeenCalledTimes(1)
    expect(deps.deleteObject).toHaveBeenCalledWith(
      'patch-submission/9-zzz/gallery/1.avif'
    )
  })

  it('leaves recent objects alone, because an upload has bytes before it has a row', async () => {
    const deps = dependencies({
      listKeys: vi
        .fn()
        .mockResolvedValue([
          { key: 'patch-submission/2-abc/gallery/1.avif', lastModified: hoursAgo(1) }
        ])
    })

    const result = await runSubmissionAssetCleanup(
      { apply: true, graceHours: 24 },
      deps
    )

    expect(result.withinGrace).toBe(1)
    expect(result.orphans).toEqual([])
    expect(deps.deleteObject).not.toHaveBeenCalled()
  })

  it('reports without deleting in a dry run', async () => {
    const deps = dependencies({
      listKeys: vi
        .fn()
        .mockResolvedValue([
          { key: 'patch-submission/3-abc/gallery/1.avif', lastModified: hoursAgo(72) }
        ])
    })

    const result = await runSubmissionAssetCleanup(
      { apply: false, graceHours: 24 },
      deps
    )

    expect(result.orphans).toHaveLength(1)
    expect(result.deleted).toBe(0)
    expect(deps.deleteObject).not.toHaveBeenCalled()
    expect(deps.purge).not.toHaveBeenCalled()
  })

  it('purges the CDN for what it deleted', async () => {
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example.test'
    const deps = dependencies({
      listKeys: vi
        .fn()
        .mockResolvedValue([
          { key: 'patch-submission/4-abc/gallery/1.avif', lastModified: hoursAgo(72) }
        ])
    })

    await runSubmissionAssetCleanup({ apply: true, graceHours: 24 }, deps)

    expect(deps.purge).toHaveBeenCalledWith([
      'https://img.example.test/patch-submission/4-abc/gallery/1.avif'
    ])
  })

  it('honours the limit', async () => {
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

    expect(result.orphans).toHaveLength(2)
    expect(deps.deleteObject).toHaveBeenCalledTimes(2)
  })
})
