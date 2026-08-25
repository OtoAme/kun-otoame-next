import { beforeEach, describe, expect, it, vi } from 'vitest'

const localforageMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    getItem: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItem: vi.fn((key: string, value: unknown) => {
      values.set(key, value)
      return Promise.resolve(value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
      return Promise.resolve()
    })
  }
})

vi.mock('localforage', () => ({
  default: {
    createInstance: () => localforageMocks
  }
}))

import {
  loadPatchSubmissionUploadDraft,
  savePatchSubmissionUploadDraft,
  type PatchSubmissionLocalUpload
} from '~/utils/patchSubmissionUploadDraft'

const item = (status: PatchSubmissionLocalUpload['status']) => ({
  clientAssetId: 'stable-client-id',
  blob: new Blob(['image'], { type: 'image/jpeg' }),
  fileName: 'image.jpg',
  mimeType: 'image/jpeg',
  lastModified: 123,
  displayOrder: 2,
  isNSFW: false,
  watermark: true,
  status,
  error: null
})

beforeEach(() => {
  localforageMocks.values.clear()
  vi.clearAllMocks()
})

describe('patch submission upload draft', () => {
  it('persists the Blob and stable client asset id', async () => {
    await savePatchSubmissionUploadDraft(7, [item('failed')])
    const restored = await loadPatchSubmissionUploadDraft(7)

    expect(restored[0]).toMatchObject({
      clientAssetId: 'stable-client-id',
      fileName: 'image.jpg',
      status: 'failed',
      watermark: true
    })
    expect(restored[0]?.blob).toBeInstanceOf(Blob)
  })

  it('turns an interrupted uploading record into a refresh-safe retry', async () => {
    await savePatchSubmissionUploadDraft(7, [item('uploading')])

    await expect(loadPatchSubmissionUploadDraft(7)).resolves.toEqual([
      expect.objectContaining({
        clientAssetId: 'stable-client-id',
        status: 'failed',
        error: '页面刷新时上传尚未完成，请重试'
      })
    ])
  })

  it('removes the localforage key after the final item succeeds', async () => {
    await savePatchSubmissionUploadDraft(7, [item('pending')])
    await savePatchSubmissionUploadDraft(7, [])

    expect(localforageMocks.removeItem).toHaveBeenCalledWith('submission:7')
    await expect(loadPatchSubmissionUploadDraft(7)).resolves.toEqual([])
  })
})
