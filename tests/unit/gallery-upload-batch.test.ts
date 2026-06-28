import { describe, expect, it, vi } from 'vitest'

import {
  uploadGalleryItems,
  type GalleryUploadQueueItem
} from '~/components/edit/utils/galleryUploadBatch'

const createFile = (name: string) =>
  new File([Buffer.from(name)], name, { type: 'image/jpeg' })

const createItem = (id: string): GalleryUploadQueueItem => ({
  id,
  file: createFile(`${id}.jpg`),
  isNSFW: false
})

describe('gallery upload batch', () => {
  it('keeps failed images with a visible error while returning successful uploads', async () => {
    const statusUpdates: { id: string; status: string; error?: string }[] = []
    const uploadOne = vi
      .fn()
      .mockResolvedValueOnce({
        imageId: 10,
        url: 'https://img.example/10.avif',
        thumbnailUrl: null
      })
      .mockResolvedValueOnce('不支持的图片格式')

    const result = await uploadGalleryItems({
      patchId: 123,
      items: [createItem('first'), createItem('second')],
      watermark: true,
      getDisplayOrder: (_item, index) => index + 5,
      uploadOne,
      onItemStatus: (item) => {
        statusUpdates.push({
          id: item.id,
          status: item.uploadStatus ?? 'pending',
          error: item.uploadError
        })
      }
    })

    expect(uploadOne).toHaveBeenCalledWith({
      patchId: 123,
      file: expect.any(File),
      isNSFW: false,
      watermark: true,
      displayOrder: 5
    })
    expect(uploadOne).toHaveBeenCalledWith({
      patchId: 123,
      file: expect.any(File),
      isNSFW: false,
      watermark: true,
      displayOrder: 6
    })
    expect(result.uploaded).toEqual([
      {
        oldId: 'first',
        imageId: 10,
        url: 'https://img.example/10.avif',
        thumbnailUrl: null,
        isNSFW: false
      }
    ])
    expect(result.failed).toEqual([
      expect.objectContaining({
        id: 'second',
        uploadStatus: 'failed',
        uploadError: '不支持的图片格式'
      })
    ])
    expect(statusUpdates).toEqual([
      { id: 'first', status: 'uploading', error: undefined },
      { id: 'first', status: 'uploaded', error: undefined },
      { id: 'second', status: 'uploading', error: undefined },
      { id: 'second', status: 'failed', error: '不支持的图片格式' }
    ])
  })

  it('turns network exceptions into retryable failed image state', async () => {
    const result = await uploadGalleryItems({
      patchId: 123,
      items: [createItem('network')],
      watermark: false,
      getDisplayOrder: () => 0,
      uploadOne: vi.fn().mockRejectedValue(new Error('fetch failed'))
    })

    expect(result.uploaded).toEqual([])
    expect(result.failed).toEqual([
      expect.objectContaining({
        id: 'network',
        uploadStatus: 'failed',
        uploadError: 'fetch failed'
      })
    ])
  })
})
