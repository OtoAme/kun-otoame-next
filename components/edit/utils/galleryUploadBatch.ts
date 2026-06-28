import { kunFetchFormData } from '~/utils/kunFetch'

export const GALLERY_UPLOAD_TIMEOUT_MS = 120000

export type GalleryUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed'

export interface GalleryUploadQueueItem {
  id: string
  file: File | Blob
  isNSFW: boolean
  uploadStatus?: GalleryUploadStatus
  uploadError?: string
}

export interface GalleryUploadOneInput {
  patchId: number
  file: File | Blob
  isNSFW: boolean
  watermark: boolean
  displayOrder: number
}

export interface GalleryUploadedItem {
  oldId: string
  imageId: number
  url: string
  thumbnailUrl: string | null
  isNSFW: boolean
}

export interface GalleryUploadResponse {
  imageId: number
  url: string
  thumbnailUrl: string | null
}

export const uploadOneGalleryImage = async ({
  patchId,
  file,
  isNSFW,
  watermark,
  displayOrder
}: GalleryUploadOneInput) => {
  const formData = new FormData()
  formData.append('patchId', patchId.toString())
  formData.append('image', file)
  formData.append('isNSFW', String(isNSFW))
  formData.append('watermark', String(watermark))
  formData.append('displayOrder', displayOrder.toString())

  return kunFetchFormData<KunResponse<GalleryUploadResponse>>(
    '/edit/gallery',
    formData,
    GALLERY_UPLOAD_TIMEOUT_MS
  )
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '图片上传失败'

export const uploadGalleryItems = async <
  T extends GalleryUploadQueueItem
>({
  patchId,
  items,
  watermark,
  getDisplayOrder,
  uploadOne = uploadOneGalleryImage,
  onItemStatus
}: {
  patchId: number
  items: T[]
  watermark: boolean
  getDisplayOrder: (item: T, index: number) => number
  uploadOne?: (
    input: GalleryUploadOneInput
  ) => Promise<KunResponse<GalleryUploadResponse>>
  onItemStatus?: (item: T) => void
}) => {
  const uploaded: GalleryUploadedItem[] = []
  const failed: T[] = []

  for (const [index, item] of items.entries()) {
    item.uploadStatus = 'uploading'
    item.uploadError = undefined
    onItemStatus?.(item)

    try {
      const result = await uploadOne({
        patchId,
        file: item.file,
        isNSFW: item.isNSFW,
        watermark,
        displayOrder: getDisplayOrder(item, index)
      })

      if (typeof result === 'string') {
        item.uploadStatus = 'failed'
        item.uploadError = result
        failed.push(item)
        onItemStatus?.(item)
        continue
      }

      item.uploadStatus = 'uploaded'
      item.uploadError = undefined
      uploaded.push({
        oldId: item.id,
        imageId: result.imageId,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        isNSFW: item.isNSFW
      })
      onItemStatus?.(item)
    } catch (error) {
      item.uploadStatus = 'failed'
      item.uploadError = getErrorMessage(error)
      failed.push(item)
      onItemStatus?.(item)
    }
  }

  return { uploaded, failed }
}
