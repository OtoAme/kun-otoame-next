import localforage from 'localforage'

export interface CreateGalleryDraftImage {
  id: string
  blob: Blob
  url: string
  isNSFW: boolean
  uploadStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed'
  uploadError?: string
}

export interface CreateGalleryCreatedPatch {
  uniqueId: string
  patchId: number
}

export const CREATE_GALLERY_DRAFT_KEY = 'kun-patch-gallery'
export const CREATE_GALLERY_WATERMARK_KEY = 'kun-patch-gallery-watermark'
export const CREATE_PATCH_CREATED_PATCH_KEY = 'kun-patch-created-patch'
export const CREATE_GALLERY_DRAFT_UPDATED_EVENT =
  'kun-create-gallery-draft-updated'

let pendingGalleryDraftSave: Promise<unknown> = Promise.resolve()

const serializeGalleryDraft = (images: CreateGalleryDraftImage[]) =>
  images.map(({ id, blob, isNSFW, uploadStatus, uploadError }) => ({
    id,
    blob,
    isNSFW,
    uploadStatus,
    uploadError,
    url: ''
  }))

export const saveCreateGalleryDraft = (images: CreateGalleryDraftImage[]) => {
  pendingGalleryDraftSave = localforage.setItem(
    CREATE_GALLERY_DRAFT_KEY,
    serializeGalleryDraft(images)
  )

  return pendingGalleryDraftSave
}

export const dispatchCreateGalleryDraftUpdated = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CREATE_GALLERY_DRAFT_UPDATED_EVENT))
}

export const waitForCreateGalleryDraftSave = async () => {
  try {
    await pendingGalleryDraftSave
  } catch (error) {
    console.error('Failed to save gallery draft:', error)
  }
}

export const getCreateGalleryDraft = async () => {
  await waitForCreateGalleryDraftSave()
  return localforage.getItem<CreateGalleryDraftImage[]>(
    CREATE_GALLERY_DRAFT_KEY
  )
}

export const getCreateGalleryRetryItems = (
  images: CreateGalleryDraftImage[],
  hasCreatedPatch: boolean
) => {
  if (!hasCreatedPatch) {
    return images.filter((img) => img.uploadStatus !== 'uploaded')
  }

  const failedImages = images.filter((img) => img.uploadStatus === 'failed')
  if (failedImages.length > 0) {
    return failedImages
  }

  return images.filter((img) => img.uploadStatus !== 'uploaded')
}

export const retainCreateGalleryUploadState = async (
  images: CreateGalleryDraftImage[],
  {
    uploadedItems,
    failedItems
  }: {
    uploadedItems: { oldId: string }[]
    failedItems: { id: string; uploadError?: string }[]
  }
) => {
  const failedMap = new Map(failedItems.map((img) => [img.id, img]))
  const uploadedIds = new Set(uploadedItems.map((img) => img.oldId))
  await saveCreateGalleryDraft(
    images.map((img) => {
      const failedItem = failedMap.get(img.id)
      if (failedItem) {
        return {
          ...img,
          uploadStatus: 'failed' as const,
          uploadError: failedItem?.uploadError ?? '图片上传失败'
        }
      }

      if (uploadedIds.has(img.id)) {
        return {
          ...img,
          uploadStatus: 'uploaded' as const,
          uploadError: undefined
        }
      }

      return img
    })
  )
  dispatchCreateGalleryDraftUpdated()
}

export const saveCreateGalleryCreatedPatch = (patch: CreateGalleryCreatedPatch) =>
  localforage.setItem(CREATE_PATCH_CREATED_PATCH_KEY, patch)

export const getCreateGalleryCreatedPatch = () =>
  localforage.getItem<CreateGalleryCreatedPatch>(CREATE_PATCH_CREATED_PATCH_KEY)

export const clearCreateGalleryDraft = async () => {
  await waitForCreateGalleryDraftSave()
  await localforage.removeItem(CREATE_GALLERY_DRAFT_KEY)
}
