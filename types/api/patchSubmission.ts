import type { MoemoepointBalance } from './moemoepoint'

export const PATCH_SUBMISSION_STATUSES = [
  'draft',
  'pending',
  'changes_requested',
  'rejected',
  'published',
  'violation',
  'deleted'
] as const

export type PatchSubmissionStatus = (typeof PATCH_SUBMISSION_STATUSES)[number]

export const PATCH_SUBMISSION_UPLOAD_STATUSES = [
  'uploading',
  'ready',
  'failed'
] as const

export type PatchSubmissionUploadStatus =
  (typeof PATCH_SUBMISSION_UPLOAD_STATUSES)[number]

/** The frozen form, kept versioned so an older draft stays readable. */
export interface PatchSubmissionPayload {
  name: string
  introduction: string
  vndbId: string
  vndbRelationId: string
  bangumiId: string
  steamId: string
  dlsiteCode: string
  dlsiteCircleName: string
  dlsiteCircleLink: string
  vndbTags: string[]
  vndbDevelopers: string[]
  bangumiTags: string[]
  bangumiDevelopers: string[]
  steamTags: string[]
  steamDevelopers: string[]
  steamAliases: string[]
  officialUrl: string
  alias: string[]
  tag: string[]
  released: string
  contentLimit: string
}

export interface PatchSubmissionGalleryImage {
  id: number
  clientAssetId: string
  uploadStatus: PatchSubmissionUploadStatus
  imageUrl: string | null
  thumbnailUrl: string | null
  isNSFW: boolean
  displayOrder: number
}

export interface PatchSubmission {
  id: number
  status: PatchSubmissionStatus
  payload: PatchSubmissionPayload
  payloadVersion: number
  revision: number
  heldAmount: number
  roleAtCreation: number
  reviewReason: string | null
  reviewedAt: string | null
  patchUniqueId: string | null
  bannerUrl: string | null
  externalSource: string | null
  externalFetchedAt: string | null
  gallery: PatchSubmissionGalleryImage[]
  submittedAt: string | null
  created: string
  updated: string
}

/** What the author's own list needs, without the full payload. */
export interface PatchSubmissionSummary {
  id: number
  status: PatchSubmissionStatus
  name: string
  heldAmount: number
  reviewReason: string | null
  bannerUrl: string | null
  patchUniqueId: string | null
  submittedAt: string | null
  created: string
  updated: string
}

export interface PatchSubmissionQuota {
  activeCount: number
  maxActive: number
  depositAmount: number
  /** Bytes already held by this user's active drafts. */
  usedBytes: number
  maxBytes: number
}

/** Every endpoint that moves a deposit returns the fresh balance with it. */
export interface PatchSubmissionMutationResult {
  submissionId: number
  status: PatchSubmissionStatus
  revision: number
  moemoepointBalance: MoemoepointBalance
}
