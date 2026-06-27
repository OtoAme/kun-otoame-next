import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildGalleryThumbnailBackfillOptions,
  getGalleryBackfillS3Key,
  getGalleryBackfillThumbnailKey,
  printGalleryThumbnailBackfillSummary,
  processGalleryThumbnailBackfillImage,
  runGalleryThumbnailBackfill,
  type GalleryThumbnailBackfillDependencies,
  type GalleryThumbnailBackfillImage
} from '~/scripts/galleryThumbnailBackfill'

const createImage = (
  overrides: Partial<GalleryThumbnailBackfillImage> = {}
): GalleryThumbnailBackfillImage => ({
  id: 456,
  patch_id: 123,
  url: 'https://img.example/patch/123/gallery/456.avif',
  thumbnail_url: null,
  patch: {
    unique_id: 'patch-unique',
    name: 'Patch Name'
  },
  ...overrides
})

const createDependencies = (
  rows: GalleryThumbnailBackfillImage[] = []
): GalleryThumbnailBackfillDependencies => ({
  getGalleryStats: vi.fn().mockResolvedValue({
    total: rows.length,
    withThumbnail: rows.filter((image) => image.thumbnail_url).length,
    missingThumbnail: rows.filter((image) => !image.thumbnail_url).length
  }),
  findImages: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
  updateThumbnailUrl: vi.fn().mockResolvedValue({ count: 1 }),
  downloadOriginal: vi.fn().mockResolvedValue(Buffer.from('original')),
  prepareThumbnail: vi.fn().mockResolvedValue({
    buffer: Buffer.from('thumbnail'),
    extension: 'avif',
    contentType: 'image/avif',
    source: 'static'
  }),
  uploadThumbnail: vi.fn().mockResolvedValue(undefined),
  deleteThumbnail: vi.fn().mockResolvedValue(undefined),
  invalidatePatchContentCache: vi.fn().mockResolvedValue(undefined)
})

describe('gallery thumbnail backfill options', () => {
  it('keeps dry-run read-only and gives apply a low production default', () => {
    expect(buildGalleryThumbnailBackfillOptions([])).toMatchObject({
      apply: false,
      batchSize: 20,
      concurrency: 1,
      delayMs: 0,
      limit: undefined
    })

    expect(buildGalleryThumbnailBackfillOptions(['--apply'])).toMatchObject({
      apply: true,
      batchSize: 20,
      concurrency: 1,
      delayMs: 1000,
      limit: 50
    })
  })

  it('parses bounded production tuning arguments', () => {
    expect(
      buildGalleryThumbnailBackfillOptions([
        '--apply',
        '--limit=0',
        '--batch=500',
        '--concurrency=12',
        '--delay=250',
        '--patch-id=123',
        '--start-id=456',
        '--max-original-mb=9',
        '--skip-animated-avif',
        '--verbose'
      ])
    ).toMatchObject({
      apply: true,
      limit: undefined,
      batchSize: 200,
      concurrency: 4,
      delayMs: 250,
      patchId: 123,
      startId: 456,
      maxOriginalBytes: 9 * 1024 * 1024,
      skipAnimatedAvif: true,
      verbose: true
    })
  })
})

describe('gallery thumbnail backfill URL handling', () => {
  beforeEach(() => {
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://s3.example'
  })

  it('extracts S3 keys from both image-bed and storage URL prefixes', () => {
    expect(
      getGalleryBackfillS3Key('https://img.example/patch/123/gallery/456.avif')
    ).toBe('patch/123/gallery/456.avif')
    expect(
      getGalleryBackfillS3Key('https://s3.example/patch/123/gallery/456.avif')
    ).toBe('patch/123/gallery/456.avif')
    expect(getGalleryBackfillS3Key('https://outside.example/a.avif')).toBeNull()
  })

  it('builds the canonical thumb-prefixed thumbnail key', () => {
    expect(getGalleryBackfillThumbnailKey(createImage(), 'webp')).toBe(
      'patch/123/gallery/thumbnail/thumb-456.webp'
    )
  })
})

describe('gallery thumbnail backfill apply behavior', () => {
  beforeEach(() => {
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://img.example'
  })

  it('dry-run scans candidates without downloading, uploading, updating, or invalidating cache', async () => {
    const deps = createDependencies([createImage()])

    const result = await runGalleryThumbnailBackfill(
      buildGalleryThumbnailBackfillOptions([]),
      deps
    )

    expect(result.galleryTotal).toBe(1)
    expect(result.alreadyWithThumbnail).toBe(0)
    expect(result.missingThumbnail).toBe(1)
    expect(result.scanned).toBe(1)
    expect(result.eligible).toBe(1)
    expect(deps.getGalleryStats).toHaveBeenCalledWith({
      patchId: undefined,
      startId: undefined
    })
    expect(deps.downloadOriginal).not.toHaveBeenCalled()
    expect(deps.uploadThumbnail).not.toHaveBeenCalled()
    expect(deps.updateThumbnailUrl).not.toHaveBeenCalled()
    expect(deps.invalidatePatchContentCache).not.toHaveBeenCalled()
  })

  it('uploads only a thumbnail and writes thumbnail_url for an apply candidate', async () => {
    const deps = createDependencies()

    const result = await processGalleryThumbnailBackfillImage(
      createImage(),
      buildGalleryThumbnailBackfillOptions(['--apply']),
      deps
    )

    expect(result.status).toBe('updated')
    expect(deps.downloadOriginal).toHaveBeenCalledWith(
      'patch/123/gallery/456.avif'
    )
    expect(deps.uploadThumbnail).toHaveBeenCalledWith(
      'patch/123/gallery/thumbnail/thumb-456.avif',
      Buffer.from('thumbnail'),
      'image/avif'
    )
    expect(deps.updateThumbnailUrl).toHaveBeenCalledWith(
      456,
      'https://img.example/patch/123/gallery/thumbnail/thumb-456.avif'
    )
  })

  it('deletes a newly uploaded thumbnail when the database update fails', async () => {
    const deps = createDependencies()
    vi.mocked(deps.updateThumbnailUrl).mockRejectedValueOnce(
      new Error('database failed')
    )

    const result = await processGalleryThumbnailBackfillImage(
      createImage(),
      buildGalleryThumbnailBackfillOptions(['--apply']),
      deps
    )

    expect(result.status).toBe('failed')
    expect(deps.deleteThumbnail).toHaveBeenCalledWith(
      'patch/123/gallery/thumbnail/thumb-456.avif'
    )
  })

  it('skips originals rejected by the size guard without uploading thumbnails', async () => {
    const deps = createDependencies()
    vi.mocked(deps.downloadOriginal).mockRejectedValueOnce(
      new Error('original is too large: 9437184 bytes')
    )

    const result = await processGalleryThumbnailBackfillImage(
      createImage(),
      buildGalleryThumbnailBackfillOptions(['--apply']),
      deps
    )

    expect(result).toEqual({
      status: 'skipped',
      imageId: 456,
      patchUniqueId: 'patch-unique',
      reason: 'original is too large: 9437184 bytes'
    })
    expect(deps.uploadThumbnail).not.toHaveBeenCalled()
    expect(deps.updateThumbnailUrl).not.toHaveBeenCalled()
  })

  it('invalidates each affected patch content cache once after apply', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const deps = createDependencies([
      createImage({ id: 456 }),
      createImage({ id: 457 })
    ])

    await runGalleryThumbnailBackfill(
      buildGalleryThumbnailBackfillOptions([
        '--apply',
        '--limit=0',
        '--delay=0'
      ]),
      deps
    )

    expect(deps.invalidatePatchContentCache).toHaveBeenCalledTimes(1)
    expect(deps.invalidatePatchContentCache).toHaveBeenCalledWith(
      'patch-unique'
    )
    consoleLog.mockRestore()
  })

  it('logs each image start and completion during apply', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const deps = createDependencies([
      createImage({
        id: 456,
        patch_id: 123,
        patch: { unique_id: 'patch-a', name: 'Game A' }
      }),
      createImage({
        id: 457,
        patch_id: 123,
        url: 'https://img.example/patch/123/gallery/457.avif',
        patch: { unique_id: 'patch-a', name: 'Game A' }
      }),
      createImage({
        id: 999,
        patch_id: 124,
        url: 'https://img.example/patch/124/gallery/999.avif',
        patch: { unique_id: 'patch-b', name: 'Game B' }
      })
    ])

    await runGalleryThumbnailBackfill(
      buildGalleryThumbnailBackfillOptions([
        '--apply',
        '--limit=0',
        '--delay=0'
      ]),
      deps
    )

    expect(consoleLog).toHaveBeenCalledWith(
      'Processing patch #123 patch-a Game A: gallery image #456'
    )
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Updated patch #123 patch-a Game A: gallery image #456 \(static\) in \d+ms$/
      )
    )
    expect(consoleLog).toHaveBeenCalledWith(
      'Processing patch #123 patch-a Game A: gallery image #457'
    )
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Updated patch #123 patch-a Game A: gallery image #457 \(static\) in \d+ms$/
      )
    )
    expect(consoleLog).toHaveBeenCalledWith(
      'Processing patch #124 patch-b Game B: gallery image #999'
    )
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Updated patch #124 patch-b Game B: gallery image #999 \(static\) in \d+ms$/
      )
    )
    consoleLog.mockRestore()
  })

  it('prints total gallery and existing thumbnail counts in the summary', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    printGalleryThumbnailBackfillSummary(
      buildGalleryThumbnailBackfillOptions([]),
      {
        galleryTotal: 108,
        alreadyWithThumbnail: 58,
        missingThumbnail: 50,
        scanned: 0,
        eligible: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        affectedUniqueIds: [],
        failures: []
      }
    )

    expect(consoleLog).toHaveBeenCalledWith(
      'Dry run complete. galleryTotal=108, alreadyWithThumbnail=58, missingThumbnail=50, scanned=0, eligible=0, updated=0, skipped=0, failed=0'
    )
    consoleLog.mockRestore()
  })
})
