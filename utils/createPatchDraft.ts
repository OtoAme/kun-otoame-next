import localforage from 'localforage'
import {
  CREATE_PATCH_CREATED_PATCH_KEY,
  CREATE_GALLERY_WATERMARK_KEY,
  clearCreateGalleryDraft
} from '~/utils/createGalleryDraft'

export const CREATE_PATCH_BANNER_KEY = 'kun-patch-banner'
export const CREATE_PATCH_ORIGINAL_BANNER_KEY = 'kun-patch-banner-original'
export { CREATE_PATCH_CREATED_PATCH_KEY }

export const clearCreatePatchDraftFiles = async () => {
  await localforage.removeItem(CREATE_PATCH_BANNER_KEY)
  await localforage.removeItem(CREATE_PATCH_ORIGINAL_BANNER_KEY)
  await localforage.removeItem(CREATE_PATCH_CREATED_PATCH_KEY)
  await clearCreateGalleryDraft()
  await localforage.removeItem(CREATE_GALLERY_WATERMARK_KEY)
}
