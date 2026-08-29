import localforage from 'localforage'

export type PatchSubmissionLocalUploadStatus =
  | 'pending'
  | 'uploading'
  | 'failed'

export interface PatchSubmissionLocalUpload {
  clientAssetId: string
  blob: Blob
  fileName: string
  mimeType: string
  lastModified: number
  displayOrder: number
  isNSFW: boolean
  watermark: boolean
  status: PatchSubmissionLocalUploadStatus
  error: string | null
}

const storage = localforage.createInstance({
  name: 'kun-otoame',
  storeName: 'patch_submission_gallery_uploads'
})

const keyFor = (submissionId: number) => `submission:${submissionId}`

const watermarkKeyFor = (submissionId: number) =>
  `submission:${submissionId}:watermark`

const orderKeyFor = (submissionId: number) => `submission:${submissionId}:order`

export const loadPatchSubmissionUploadDraft = async (submissionId: number) => {
  const items =
    (await storage.getItem<PatchSubmissionLocalUpload[]>(
      keyFor(submissionId)
    )) ?? []

  return items.map((item) =>
    item.status === 'uploading'
      ? {
          ...item,
          status: 'failed' as const,
          error: '页面刷新时上传尚未完成，请重试'
        }
      : item
  )
}

export const savePatchSubmissionUploadDraft = async (
  submissionId: number,
  items: PatchSubmissionLocalUpload[]
) => {
  if (!items.length) {
    await storage.removeItem(keyFor(submissionId))
    return
  }
  await storage.setItem(keyFor(submissionId), items)
}

export const clearPatchSubmissionUploadDraft = (submissionId: number) =>
  storage.removeItem(keyFor(submissionId))

export const loadPatchSubmissionWatermark = async (submissionId: number) => {
  const stored = await storage.getItem<boolean>(watermarkKeyFor(submissionId))
  return stored ?? true
}

export const savePatchSubmissionWatermark = async (
  submissionId: number,
  watermark: boolean
) => {
  await storage.setItem(watermarkKeyFor(submissionId), watermark)
}

export const clearPatchSubmissionWatermark = (submissionId: number) =>
  storage.removeItem(watermarkKeyFor(submissionId))

/**
 * The order the author dragged into place, as one namespaced sequence spanning
 * both stores (`server:<galleryId>` / `local:<clientAssetId>`). Cloud rows only
 * move when the author presses 保存排序, so the record existing *is* the unsaved
 * flag: it is written on every drag and removed only once the server has
 * accepted the sequence.
 */
export const loadPatchSubmissionGalleryOrder = async (submissionId: number) => {
  const stored = await storage.getItem<string[]>(orderKeyFor(submissionId))
  if (!Array.isArray(stored)) return null
  return stored.filter((key): key is string => typeof key === 'string')
}

export const savePatchSubmissionGalleryOrder = async (
  submissionId: number,
  sequence: string[]
) => {
  await storage.setItem(orderKeyFor(submissionId), sequence)
}

export const clearPatchSubmissionGalleryOrder = (submissionId: number) =>
  storage.removeItem(orderKeyFor(submissionId))

/** The server cannot reach browser storage, so deleting a draft clears every
 *  per-submission key from the caller side. */
export const clearPatchSubmissionDraftStorage = async (
  submissionId: number
) => {
  await clearPatchSubmissionUploadDraft(submissionId)
  await clearPatchSubmissionWatermark(submissionId)
  await clearPatchSubmissionGalleryOrder(submissionId)
}
