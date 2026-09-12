import type { ShoutboxLevel, ShoutboxStatus } from '~/constants/shoutbox'
import type { MoemoepointBalance } from './moemoepoint'

export type { ShoutboxLevel, ShoutboxStatus } from '~/constants/shoutbox'

export interface ShoutboxPatchSummary {
  id: number
  uniqueId: string
  name: string
  contentLimit: string
}

export interface ShoutboxAuthor {
  id: number
  name: string
  avatar: string
}

export interface ShoutboxItem {
  id: number
  user: ShoutboxAuthor
  /** Whether the current author is eligible to receive a new report. */
  reportable: boolean
  content: string
  link: string
  official: boolean
  level: ShoutboxLevel
  status: ShoutboxStatus
  cost: number
  patch: ShoutboxPatchSummary | null
  effectiveFrom: string | null
  effectiveTo: string | null
  editedAt: string | null
  hiddenAt: string | null
  refundedAt: string | null
  created: string
  updated: string
}

export interface ShoutboxPublishResponse extends ShoutboxItem {
  moemoepointBalance: MoemoepointBalance
}

export interface ShoutboxListResponse {
  pinned: ShoutboxItem | null
  shoutboxes: ShoutboxItem[]
  page: number
  totalPages: number
  validUntil: string
  visibilityUntil?: string | null
}

/** Home uses one fixed response page and exposes whether a more link is useful. */
export interface ShoutboxHomeResponse extends ShoutboxListResponse {
  hasMore: boolean
}

export interface ShoutboxBannerResponse {
  banner: ShoutboxItem | null
  validUntil: string
  visibilityUntil?: string | null
}

export interface ShoutboxProfileResponse {
  shoutboxes: ShoutboxItem[]
  page: number
  totalPages: number
}

export type ShoutboxModerationAction = 'hide' | 'remove' | 'restore' | 'resolve'

export type ShoutboxModerationResolution = 'accept' | 'reject'

export interface ShoutboxPendingReport {
  id: number
  reason: string
  sender: ShoutboxAuthor
  created: string
}

export interface AdminShoutboxReviewItem extends ShoutboxItem {
  pendingReports: ShoutboxPendingReport[]
}

export interface AdminShoutboxListResponse {
  shoutboxes: Array<ShoutboxItem | AdminShoutboxReviewItem>
  page: number
  totalPages: number
}
