import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  objects: new Map<string, unknown>(),
  send: vi.fn()
}))

vi.mock('@aws-sdk/client-s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-s3')>()),
  S3Client: vi.fn(function () {
    return { send: storage.send }
  })
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('file bytes')),
  rm: vi.fn()
}))

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => Buffer.from('video bytes'))
}))

import {
  deleteFileFromS3,
  getS3PublicUrl,
  uploadBufferToS3,
  uploadFileToS3,
  uploadImageToS3,
  uploadVideoToS3
} from '~/lib/s3'

beforeEach(() => {
  vi.clearAllMocks()
  storage.objects.clear()
  storage.send.mockImplementation(async (command) => {
    const { Key, Body } = command.input
    if (command.constructor.name === 'PutObjectCommand') {
      storage.objects.set(Key, Body)
    } else if (command.constructor.name === 'DeleteObjectCommand') {
      storage.objects.delete(Key)
    } else {
      throw new Error('Unexpected storage command')
    }
    return {}
  })
  vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', '')
})

afterEach(() => vi.unstubAllEnvs())

describe('S3 environment prefixes', () => {
  it.each([undefined, '', '   '])(
    'preserves existing keys when the prefix is %j',
    async (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      const key = 'patch/123/banner/banner.avif'

      await uploadImageToS3(key, Buffer.from('image'))
      expect(storage.objects.get(key)).toEqual(Buffer.from('image'))
      await deleteFileFromS3(key)
      expect(storage.objects.size).toBe(0)
    }
  )

  it('isolates identical business keys across worktrees for uploads and deletion', async () => {
    const key = 'patch/123/banner/banner.avif'
    storage.objects.set(key, Buffer.from('production'))

    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-a')
    await uploadImageToS3(key, Buffer.from('image A'))
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-b')
    await uploadImageToS3(key, Buffer.from('image B'))

    expect(storage.objects.get(`worktrees/wt-a/${key}`)).toEqual(
      Buffer.from('image A')
    )
    expect(storage.objects.get(`worktrees/wt-b/${key}`)).toEqual(
      Buffer.from('image B')
    )

    await deleteFileFromS3(key)
    expect(storage.objects.has(`worktrees/wt-b/${key}`)).toBe(false)
    expect(storage.objects.get(`worktrees/wt-a/${key}`)).toEqual(
      Buffer.from('image A')
    )
    expect(storage.objects.get(key)).toEqual(Buffer.from('production'))
  })

  it('applies the same prefix to buffers, local files and videos', async () => {
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-a')

    await uploadBufferToS3('stickers/a.avif', Buffer.from('sticker'))
    await uploadFileToS3('patch/1/resource/a.zip', '/synthetic/resource.zip')
    await uploadVideoToS3('/synthetic/video.mp4', 'a.mp4', 'video/mp4', 'game')

    expect([...storage.objects.keys()]).toEqual([
      'worktrees/wt-a/stickers/a.avif',
      'worktrees/wt-a/patch/1/resource/a.zip',
      'worktrees/wt-a/touchgal/galgame/game/video/a.mp4'
    ])
  })

  it('normalizes surrounding whitespace and slashes', async () => {
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', ' /worktrees/wt-a/ ')
    await uploadImageToS3('patch/1/banner.avif', Buffer.from('image'))
    expect([...storage.objects.keys()]).toEqual([
      'worktrees/wt-a/patch/1/banner.avif'
    ])
  })

  it.each([
    '/',
    'worktrees/../wt-a',
    './wt-a',
    'worktrees//wt-a',
    'wt?a',
    'wt%2Fa',
    'wt\\a'
  ])(
    'rejects an invalid configured prefix before touching storage: %s',
    async (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      await expect(
        uploadImageToS3('patch/1/banner.avif', Buffer.from('image'))
      ).rejects.toThrow('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX')
      await expect(deleteFileFromS3('patch/1/banner.avif')).rejects.toThrow(
        'KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX'
      )
      expect(storage.send).not.toHaveBeenCalled()
    }
  )

  it('automatically adds the prefix to a public root that has its own path', () => {
    vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', 'worktrees/wt-a')
    vi.stubEnv(
      'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL',
      'https://img.example/assets/'
    )
    expect(getS3PublicUrl('patch/1/banner.avif')).toBe(
      'https://img.example/assets/worktrees/wt-a/patch/1/banner.avif'
    )
  })

  it.each([undefined, '', '   '])(
    'keeps public URLs unchanged with prefix %j',
    (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      vi.stubEnv(
        'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL',
        'https://img.example/assets/'
      )
      expect(getS3PublicUrl('patch/1/banner.avif')).toBe(
        'https://img.example/assets/patch/1/banner.avif'
      )
    }
  )
})
