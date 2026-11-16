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
  vi.unstubAllEnvs()
  process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL = originalPublic
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = originalImageBed
})

describe('extractS3Key', () => {
  it.each([
    { image: 'https://img.example', storage: 'https://img.example/cdn', prefix: '', path: 'cdn' },
    { image: 'https://img.example/cdn', storage: 'https://img.example', prefix: '', path: 'cdn' },
    { image: 'https://img.example', storage: 'https://img.example/cdn', prefix: 'cdn', path: 'cdn/cdn' }
  ])('uses the most specific public base with prefix "$prefix" and image root $image', ({ image, storage, prefix, path }) => {
    vi.stubEnv('KUN_VISUAL_NOVEL_IMAGE_BED_URL', image)
    vi.stubEnv('NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL', storage)
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
    expect(extractS3Key(`https://img.example/${path}/patch/1/banner.avif`))
      .toBe('patch/1/banner.avif')
  })

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

  it('extracts relative keys only from the current worktree public roots', () => {
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-a')
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL =
      'https://public.example'
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL =
      'https://image.example/'

    expect(
      extractS3Key('https://public.example/worktrees/wt-a/patch/1/banner.avif')
    ).toBe('patch/1/banner.avif')
    expect(
      extractS3Key('https://image.example/worktrees/wt-a/patch/1/banner.avif')
    ).toBe('patch/1/banner.avif')
    expect(
      extractS3Key('https://public.example/worktrees/wt-ab/patch/1/banner.avif')
    ).toBeNull()
    expect(extractS3Key('https://public.example/patch/1/banner.avif')).toBeNull()
  })
})
