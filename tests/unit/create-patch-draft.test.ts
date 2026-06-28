import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CREATE_PATCH_BANNER_KEY,
  CREATE_PATCH_CREATED_PATCH_KEY,
  CREATE_PATCH_ORIGINAL_BANNER_KEY,
  clearCreatePatchDraftFiles
} from '~/utils/createPatchDraft'
import {
  CREATE_GALLERY_DRAFT_UPDATED_EVENT,
  CREATE_GALLERY_DRAFT_KEY,
  CREATE_GALLERY_WATERMARK_KEY,
  getCreateGalleryDraft,
  getCreateGalleryRetryItems,
  retainCreateGalleryUploadState,
  saveCreateGalleryCreatedPatch
} from '~/utils/createGalleryDraft'

const localforageMocks = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    store,
    removeItem: vi.fn((key: string) => {
      store.delete(key)
      return Promise.resolve()
    }),
    setItem: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve(value)
    }),
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null))
  }
})

vi.mock('localforage', () => ({
  default: {
    removeItem: localforageMocks.removeItem,
    setItem: localforageMocks.setItem,
    getItem: localforageMocks.getItem
  }
}))

describe('create patch draft helpers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localforageMocks.store.clear()
    localforageMocks.removeItem.mockClear()
    localforageMocks.setItem.mockClear()
    localforageMocks.getItem.mockClear()
  })

  it('clears stored create-page files when resetting edit information', async () => {
    await clearCreatePatchDraftFiles()

    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      CREATE_PATCH_BANNER_KEY
    )
    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      CREATE_PATCH_ORIGINAL_BANNER_KEY
    )
    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      CREATE_PATCH_CREATED_PATCH_KEY
    )
    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      CREATE_GALLERY_DRAFT_KEY
    )
    expect(localforageMocks.removeItem).toHaveBeenCalledWith(
      CREATE_GALLERY_WATERMARK_KEY
    )
  })

  it('keeps all gallery images while marking only failed images after create publish upload failures', async () => {
    const firstBlob = new Blob(['first'], { type: 'image/jpeg' })
    const secondBlob = new Blob(['second'], { type: 'image/jpeg' })
    const thirdBlob = new Blob(['third'], { type: 'image/jpeg' })

    await retainCreateGalleryUploadState(
      [
        { id: 'first', blob: firstBlob, url: 'blob:first', isNSFW: false },
        { id: 'second', blob: secondBlob, url: 'blob:second', isNSFW: true },
        { id: 'third', blob: thirdBlob, url: 'blob:third', isNSFW: false }
      ],
      {
        uploadedItems: [{ oldId: 'first' }, { oldId: 'third' }],
        failedItems: [{ id: 'second', uploadError: '不支持的图片格式' }]
      }
    )

    expect(await getCreateGalleryDraft()).toEqual([
      {
        id: 'first',
        blob: firstBlob,
        isNSFW: false,
        uploadStatus: 'uploaded',
        uploadError: undefined,
        url: ''
      },
      {
        id: 'second',
        blob: secondBlob,
        isNSFW: true,
        uploadStatus: 'failed',
        uploadError: '不支持的图片格式',
        url: ''
      },
      {
        id: 'third',
        blob: thirdBlob,
        isNSFW: false,
        uploadStatus: 'uploaded',
        uploadError: undefined,
        url: ''
      }
    ])
  })

  it('returns only failed gallery images for create publish retry uploads', () => {
    const failedBlob = new Blob(['failed'], { type: 'image/jpeg' })

    const retryItems = getCreateGalleryRetryItems(
      [
        {
          id: 'uploaded',
          blob: new Blob(['uploaded'], { type: 'image/jpeg' }),
          url: 'blob:uploaded',
          isNSFW: false,
          uploadStatus: 'uploaded'
        },
        {
          id: 'failed',
          blob: failedBlob,
          url: 'blob:failed',
          isNSFW: true,
          uploadStatus: 'failed',
          uploadError: '网络错误'
        }
      ],
      true
    )

    expect(retryItems).toEqual([
      {
        id: 'failed',
        blob: failedBlob,
        url: 'blob:failed',
        isNSFW: true,
        uploadStatus: 'failed',
        uploadError: '网络错误'
      }
    ])
  })

  it('retries pending gallery images if the created patch was saved before upload state was written', () => {
    const pendingBlob = new Blob(['pending'], { type: 'image/jpeg' })

    expect(
      getCreateGalleryRetryItems(
        [
          {
            id: 'uploaded',
            blob: new Blob(['uploaded'], { type: 'image/jpeg' }),
            url: 'blob:uploaded',
            isNSFW: false,
            uploadStatus: 'uploaded'
          },
          {
            id: 'pending',
            blob: pendingBlob,
            url: 'blob:pending',
            isNSFW: false,
            uploadStatus: 'pending'
          }
        ],
        true
      )
    ).toEqual([
      {
        id: 'pending',
        blob: pendingBlob,
        url: 'blob:pending',
        isNSFW: false,
        uploadStatus: 'pending'
      }
    ])
  })

  it('notifies the create gallery input after retaining failed upload images', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })

    await retainCreateGalleryUploadState(
      [
        {
          id: 'failed',
          blob: new Blob(['failed'], { type: 'image/jpeg' }),
          url: 'blob:failed',
          isNSFW: false
        }
      ],
      {
        uploadedItems: [],
        failedItems: [{ id: 'failed', uploadError: '网络错误' }]
      }
    )

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: CREATE_GALLERY_DRAFT_UPDATED_EVENT })
    )
  })

  it('persists the created patch target for later gallery retry', async () => {
    await saveCreateGalleryCreatedPatch({
      patchId: 123,
      uniqueId: 'abc123'
    })

    expect(localforageMocks.setItem).toHaveBeenCalledWith(
      CREATE_PATCH_CREATED_PATCH_KEY,
      { patchId: 123, uniqueId: 'abc123' }
    )
  })
})
