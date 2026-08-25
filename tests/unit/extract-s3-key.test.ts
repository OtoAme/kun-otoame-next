import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/redis', () => ({
  consumeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  releaseUploadConsumeLock: vi.fn()
}))
vi.mock('~/lib/s3', () => ({
  cleanupLocalUpload: vi.fn(),
  deleteFileFromS3: vi.fn(),
  uploadFileToS3: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: {} }))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
import { extractS3Key } from '~/app/api/patch/resource/_helper'

const originalPublic =
  process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL
const originalImageBed = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL

afterEach(() => {
  process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL = originalPublic
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = originalImageBed
})

describe('extractS3Key', () => {
  it('accepts both configured public storage bases', () => {
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://public.example/'
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://image.example'

    expect(extractS3Key('https://public.example/patch-submission/a.avif')).toBe(
      'patch-submission/a.avif'
    )
    expect(extractS3Key('https://image.example/patch-submission/a.avif')).toBe(
      'patch-submission/a.avif'
    )
  })

  it('rejects lookalike and external hosts', () => {
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://public.example'
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://image.example'

    expect(
      extractS3Key('https://public.example.evil/patch-submission/a.avif')
    ).toBeNull()
    expect(
      extractS3Key('https://external.example/patch-submission/a.avif')
    ).toBeNull()
  })
})
