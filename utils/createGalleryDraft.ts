import localforage from 'localforage'

export interface CreateGalleryDraftImage {
  id: string
  blob: Blob
  url: string
  isNSFW: boolean
}

export const CREATE_GALLERY_DRAFT_KEY = 'kun-patch-gallery'
export const CREATE_GALLERY_WATERMARK_KEY = 'kun-patch-gallery-watermark'

let pendingGalleryDraftSave: Promise<unknown> = Promise.resolve()

const serializeGalleryDraft = (images: CreateGalleryDraftImage[]) =>
  images.map(({ id, blob, isNSFW }) => ({
    id,
    blob,
    isNSFW,
    url: ''
  }))

export const saveCreateGalleryDraft = (images: CreateGalleryDraftImage[]) => {
  pendingGalleryDraftSave = localforage.setItem(
    CREATE_GALLERY_DRAFT_KEY,
    serializeGalleryDraft(images)
  )

  return pendingGalleryDraftSave
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

export const clearCreateGalleryDraft = async () => {
  await waitForCreateGalleryDraftSave()
  await localforage.removeItem(CREATE_GALLERY_DRAFT_KEY)
}
