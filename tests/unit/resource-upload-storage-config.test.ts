import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  upload: vi.fn(),
  release: vi.fn()
}))
vi.mock('~/lib/redis', () => ({
  consumeUpload: mocks.consume,
  finalizeUpload: vi.fn(),
  releaseUploadConsumeLock: mocks.release
}))
vi.mock('~/lib/s3', () => ({
  cleanupLocalUpload: vi.fn(),
  deleteFileFromS3: vi.fn(),
  uploadFileToS3: mocks.upload
}))
vi.mock('~/prisma/index', () => ({ prisma: {} }))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))

import { uploadPatchResource } from '~/app/api/patch/resource/_helper'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv(
    'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL',
    'https://cdn.example/assets/'
  )
  vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', '')
  mocks.consume.mockResolvedValue({
    ok: true,
    token: 'synthetic-lock',
    data: {
      hash: 'synthetic-hash',
      filename: 'file.zip',
      path: '/synthetic/file.zip',
      localDir: '/synthetic',
      size: '1 MB'
    }
  })
  mocks.upload.mockResolvedValue(undefined)
  mocks.release.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('resource upload storage configuration', () => {
  it.each([undefined, '', '   '])(
    'rejects public root %j before reserving or uploading a file',
    async (root) => {
      vi.stubEnv('NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL', root)
      await expect(
        uploadPatchResource(12, 'synthetic-upload', 7)
      ).rejects.toThrow('NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL')
      expect(mocks.consume).not.toHaveBeenCalled()
      expect(mocks.upload).not.toHaveBeenCalled()
      expect(mocks.release).not.toHaveBeenCalled()
    }
  )

  it.each(['', 'worktrees/wt-a'])(
    'uses the validated public root and relative storage key with prefix %j',
    async (prefix) => {
      vi.stubEnv('KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX', prefix)
      const result = await uploadPatchResource(12, 'synthetic-upload', 7)
      const key = 'patch/12/resource/synthetic-hash/file.zip'
      const base = prefix
        ? 'https://cdn.example/assets/worktrees/wt-a'
        : 'https://cdn.example/assets'
      expect(result).toMatchObject({
        s3Key: key,
        downloadLink: `${base}/${key}`,
        consumeToken: 'synthetic-lock'
      })
      expect(mocks.upload).toHaveBeenCalledWith(key, '/synthetic/file.zip')
      expect(mocks.release).not.toHaveBeenCalled()
    }
  )

  it('still releases the consumed upload when storage fails', async () => {
    const failure = new Error('storage unavailable')
    mocks.upload.mockRejectedValueOnce(failure)
    await expect(uploadPatchResource(12, 'synthetic-upload', 7)).rejects.toBe(
      failure
    )
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(
      'synthetic-upload',
      'synthetic-lock'
    )
  })

  it('preserves ownership rejection without touching storage', async () => {
    mocks.consume.mockResolvedValueOnce({ ok: false, code: 'OWNER_MISMATCH' })
    expect(await uploadPatchResource(12, 'synthetic-upload', 7)).toBe(
      '上传资源不属于当前用户'
    )
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
