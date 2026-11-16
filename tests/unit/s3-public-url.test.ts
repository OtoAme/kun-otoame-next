import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getImageBedBaseUrl,
  getImageBedUrl,
  getS3PublicBaseUrl,
  getS3PublicBases,
  getS3PublicUrl
} from '~/lib/s3Url'

beforeEach(() => {
  vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', '')
  vi.stubEnv(
    'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL',
    'https://cdn.example/assets/'
  )
  vi.stubEnv('KUN_VISUAL_NOVEL_IMAGE_BED_URL', 'https://img.example/images/')
})

afterEach(() => vi.unstubAllEnvs())

describe('public URLs from storage roots', () => {
  it.each([undefined, '', '   '])(
    'preserves production URLs with prefix %j',
    (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      expect(getS3PublicUrl('stickers/a.avif')).toBe(
        'https://cdn.example/assets/stickers/a.avif'
      )
      expect(getImageBedUrl('patch/1/banner.avif')).toBe(
        'https://img.example/images/patch/1/banner.avif'
      )
    }
  )

  it('normalizes separators and keeps each root path when adding the environment prefix', () => {
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', ' /worktrees/wt-a/ ')
    expect(getS3PublicBaseUrl()).toBe(
      'https://cdn.example/assets/worktrees/wt-a'
    )
    expect(getImageBedBaseUrl()).toBe(
      'https://img.example/images/worktrees/wt-a'
    )
    expect(getImageBedUrl('user/avatar/user_7/avatar-mini.avif?v=123')).toBe(
      'https://img.example/images/worktrees/wt-a/user/avatar/user_7/avatar-mini.avif?v=123'
    )
  })

  it('returns matching environment bases for cleanup and deduplicates a shared root', () => {
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-a')
    expect(getS3PublicBases()).toEqual([
      'https://img.example/images/worktrees/wt-a',
      'https://cdn.example/assets/worktrees/wt-a'
    ])
    vi.stubEnv('KUN_VISUAL_NOVEL_IMAGE_BED_URL', 'https://cdn.example/assets')
    expect(getS3PublicBases()).toEqual([
      'https://cdn.example/assets/worktrees/wt-a'
    ])
  })

  it('keeps nullable storage URLs and rejects a missing required image root', () => {
    expect(getS3PublicUrl(null)).toBeNull()
    expect(getS3PublicUrl(undefined)).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL', '')
    expect(getS3PublicUrl('a.avif')).toBeNull()
    vi.stubEnv('KUN_VISUAL_NOVEL_IMAGE_BED_URL', '')
    expect(getS3PublicBases()).toEqual([])
    expect(() => getImageBedUrl('a.avif')).toThrow(
      'KUN_VISUAL_NOVEL_IMAGE_BED_URL'
    )
  })
})
