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
  clearPatchSubmissionDraftStorage,
  clearPatchSubmissionGalleryOrder,
  loadPatchSubmissionGalleryOrder,
  loadPatchSubmissionUploadDraft,
  loadPatchSubmissionWatermark,
  savePatchSubmissionGalleryOrder,
  savePatchSubmissionUploadDraft,
  savePatchSubmissionWatermark,
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

describe('patch submission watermark option', () => {
  it('defaults to on and keeps an explicit opt-out on its own key', async () => {
    await expect(loadPatchSubmissionWatermark(7)).resolves.toBe(true)

    await savePatchSubmissionWatermark(7, false)

    expect(localforageMocks.setItem).toHaveBeenCalledWith(
      'submission:7:watermark',
      false
    )
    await expect(loadPatchSubmissionWatermark(7)).resolves.toBe(false)
  })

  it('is scoped per submission', async () => {
    await savePatchSubmissionWatermark(7, false)

    await expect(loadPatchSubmissionWatermark(8)).resolves.toBe(true)
  })

  it('clears the items, the watermark and the order key together', async () => {
    await savePatchSubmissionUploadDraft(7, [item('pending')])
    await savePatchSubmissionWatermark(7, false)
    await savePatchSubmissionGalleryOrder(7, ['server:9'])

    await clearPatchSubmissionDraftStorage(7)

    expect(localforageMocks.removeItem).toHaveBeenCalledWith('submission:7')
    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      'submission:7:watermark'
    )
    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      'submission:7:order'
    )
    await expect(loadPatchSubmissionUploadDraft(7)).resolves.toEqual([])
    await expect(loadPatchSubmissionWatermark(7)).resolves.toBe(true)
    await expect(loadPatchSubmissionGalleryOrder(7)).resolves.toBeNull()
  })
})

describe('patch submission gallery order draft', () => {
  it('keeps the sequence namespaced across both stores', async () => {
    await savePatchSubmissionGalleryOrder(7, [
      'server:9',
      'local:stable-client-id',
      'server:10'
    ])

    expect(localforageMocks.setItem).toHaveBeenCalledWith(
      'submission:7:order',
      ['server:9', 'local:stable-client-id', 'server:10']
    )
    await expect(loadPatchSubmissionGalleryOrder(7)).resolves.toEqual([
      'server:9',
      'local:stable-client-id',
      'server:10'
    ])
  })

  // The record existing is what "unsaved order" means, so no record must read
  // back as null rather than as an empty sequence.
  it('reads back as null until a sequence has been stored', async () => {
    await expect(loadPatchSubmissionGalleryOrder(7)).resolves.toBeNull()
  })

  it('is scoped per submission', async () => {
    await savePatchSubmissionGalleryOrder(7, ['server:9'])

    await expect(loadPatchSubmissionGalleryOrder(8)).resolves.toBeNull()
  })

  it('drops the record once the server has accepted the sequence', async () => {
    await savePatchSubmissionGalleryOrder(7, ['server:9'])

    await clearPatchSubmissionGalleryOrder(7)

    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      'submission:7:order'
    )
    await expect(loadPatchSubmissionGalleryOrder(7)).resolves.toBeNull()
  })
})
