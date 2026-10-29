import type { HelpCategory, HelpStatus } from '~/constants/help'
import type { MoemoepointBalance } from './moemoepoint'

export interface HelpUser {
  id: number
  name: string
  avatar: string
}

export interface HelpPatchLink {
  id: number
  uniqueId: string
  name: string
}

export interface HelpResourceLink {
  id: number
  name: string
  section: string
  /** Share link of the resource card on its game page. */
  href: string
}

export interface HelpPostSummary {
  id: number
  category: HelpCategory
  title: string
  /** Plain-text excerpt for lists. */
  excerpt: string
  status: HelpStatus
  user: HelpUser | null
  patch: HelpPatchLink | null
  gameName: string
  gameLinkCount: number
  answerCount: number
  followCount: number
  /** First image in the post body, shown as the list thumbnail. */
  thumbnail: string | null
  created: string
}

export interface HelpListResponse {
  posts: HelpPostSummary[]
  total: number
}

export interface HelpReply {
  id: number
  /** Plain text; replies carry no markdown. */
  content: string
  user: HelpUser | null
  /** Whom this reply answers, when it names someone in the thread. */
  replyTo: HelpUser | null
  hidden: boolean
  canEdit: boolean
  created: string
  updated: string
}

export interface HelpSidebarItem {
  id: number
  title: string
  status: HelpStatus
}

export interface HelpSidebarResponse {
  total: number
  categoryCounts: Record<HelpCategory, number>
  /** Latest few own and followed posts with their full count; null for guests. */
  mine: { items: HelpSidebarItem[]; total: number } | null
  followed: { items: HelpSidebarItem[]; total: number } | null
}

export interface HelpAnswer {
  id: number
  /** Rendered and sanitized HTML. */
  content: string
  /** Raw markdown, returned only to the author for editing. */
  markdown?: string
  user: HelpUser | null
  usefulCount: number
  isUseful: boolean
  isAccepted: boolean
  /** Hidden by moderation; only its author and the asker still see it. */
  hidden: boolean
  canEdit: boolean
  canDelete: boolean
  replies: HelpReply[]
  created: string
  updated: string
}

export interface HelpPostDetail {
  id: number
  category: HelpCategory
  title: string
  /** Rendered and sanitized HTML. */
  content: string
  markdown?: string
  status: HelpStatus
  user: HelpUser | null
  patch: HelpPatchLink | null
  gameName: string
  /** Reference pages for a game the site has no entry for. */
  gameLinks: string[]
  resource: HelpResourceLink | null
  acceptedAnswerId: number | null
  hidden: boolean
  followCount: number
  isFollowing: boolean
  isAuthor: boolean
  canDelete: boolean
  canAnswer: boolean
  answers: HelpAnswer[]
  created: string
  updated: string
}

export interface HelpPostCreateResponse {
  postId: number
  moemoepointBalance: MoemoepointBalance
}

export interface HelpAcceptResponse {
  status: HelpStatus
  acceptedAnswerId: number | null
  /** True only for the one call that paid the answerer. */
  rewarded: boolean
}

export interface HelpPostFormState {
  balance: MoemoepointBalance
  postsToday: number
  dailyLimit: number
  fee: number
}

export interface HelpSimilarItem {
  id: number
  title: string
  status: HelpStatus
  answerCount: number
}
