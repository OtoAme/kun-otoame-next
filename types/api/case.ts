import type {
  CaseActorType,
  CaseContentAction,
  CaseEscalationTrigger,
  CaseKind,
  CaseMessageEvent,
  CaseMessageKind,
  CaseOwnerType,
  CaseResolution,
  CaseSource,
  CaseStatus,
  CaseTargetType,
  CaseTab
} from '~/constants/case'

export type {
  CaseActorType,
  CaseContentAction,
  CaseEscalationTrigger,
  CaseKind,
  CaseMessageEvent,
  CaseMessageKind,
  CaseOwnerType,
  CaseResolution,
  CaseSource,
  CaseStatus,
  CaseTargetType,
  CaseTab
} from '~/constants/case'

export interface CasePatchSummary {
  id: number
  uniqueId: string
  name: string
}

export interface CaseResourceSummary {
  id: number
  name: string
  section: string
  patchId: number
  patch: CasePatchSummary | null
  status: number
}

export interface CaseTargetSummary {
  targetType: CaseTargetType
  targetId: number
  deleted: boolean
  /** Target status used by moderation actions, currently shoutbox 0/2/3. */
  status?: number
  patch: CasePatchSummary | null
  resource: CaseResourceSummary | null
  label?: string
}

export interface CaseUserSummary {
  id: number
  name: string
  avatar: string
}

export interface CaseActorSummary extends CaseUserSummary {
  role?: number
}

/**
 * Public resource badge, one per open public case on the resource. It is
 * deliberately limited to kind, count and owner.
 */
export interface PatchCaseSummary {
  kind: CaseKind
  reportCount: number
  ownerType: Extract<CaseOwnerType, 'publisher' | 'staff'>
}

export interface CaseMessagePayload {
  resolution?: CaseResolution
  closed_at?: string
  actor_type?: CaseActorType
  from_status?: CaseStatus
  to_status?: CaseStatus
  from_state_entered_at?: string
  queue_entered_at?: string
  first_owner_response_at?: string | null
  from_owner_type?: CaseOwnerType
  from_owner_id?: number | null
  from_patch_id?: number | null
  to_patch_id?: number | null
  resource_id?: number
  previous_resource_status?: number
  handled_target?: 'comment' | 'rating' | 'shoutbox' | 'user' | 'missing'
  escalation_trigger?: CaseEscalationTrigger
  solved?: boolean
}

export interface CaseMessage {
  id: number
  kind: CaseMessageKind
  event: CaseMessageEvent | null
  body: string
  author: CaseActorSummary | null
  payload?: CaseMessagePayload | null
  /** Image URLs of this note; present only where the dialogue is visible. */
  images?: string[]
  created: string
}

export type CaseMessagePreview = Pick<
  CaseMessage,
  'id' | 'kind' | 'event' | 'body' | 'created'
>

export interface CaseSummary {
  id: number
  kind: CaseKind
  targetType: CaseTargetType
  targetId: number
  target: CaseTargetSummary
  patchId: number | null
  ownerType: CaseOwnerType
  owner: CaseActorSummary | null
  /** Omitted or null when the viewer is not allowed to identify reporters. */
  reporter?: CaseActorSummary | null
  status: CaseStatus
  resolution: CaseResolution | null
  public: boolean
  source: CaseSource
  /** Null means the viewer is intentionally not allowed to see the count. */
  subscriberCount: number | null
  reopenedCount: number
  escalatedAt: string | null
  firstOwnerResponseAt: string | null
  closedAt: string | null
  statusChangedAt: string
  queueEnteredAt: string
  hiddenAt: string | null
  restoredAt: string | null
  created: string
  updated: string
}

export interface CaseListItem extends CaseSummary {
  /** A list can omit messages while preserving the same summary shape. */
  latestMessage?: CaseMessagePreview | null
  /** The viewer still has an unread notification pointing at this case. */
  hasUnread: boolean
  /** The viewer is the publisher this case was handed off from (D20). */
  handedOff: boolean
  canReply: boolean
  canResolve: boolean
  canReopen: boolean
}

/** Admin list rows always include the latest message preview for dense queues. */
export interface AdminCaseListItem extends CaseSummary {
  latestMessage: CaseMessagePreview | null
}

export interface CaseDetail extends CaseSummary {
  messages: CaseMessage[]
  /** For private reports this only contains the requesting user's own record. */
  viewerSubscription?: {
    subscribed: boolean
    submitted: boolean
  }
  capabilities: CaseCapabilities
}

export interface CaseCapabilities {
  canReply: boolean
  canResolve: boolean
  canReopen: boolean
  /** Opener withdraws while the case is open (D18). */
  canWithdraw: boolean
  /** Opener answers「解决了 / 没解决」for the latest closure (D19). */
  canConfirm: boolean
  /** Opener asks the site administrator to review a publisher's closure (D16). */
  canReview: boolean
  /** Publisher the case was handed off from proposes a closure (D20). */
  canPropose: boolean
  canHideResource: boolean
  canRestoreResource: boolean
  canMoveResource: boolean
  canHandleContent: boolean
  canConfirmUserHandled: boolean
  /** Actions are derived from the current target state; the UI must not infer them. */
  allowedContentActions: CaseContentAction[]
  allowedResolutions: CaseResolution[]
}

/** 当前作用域内按状态的条数；每个 CaseStatus 键都存在，无数据为 0。 */
export type CaseStatusCounts = Record<CaseStatus, number>

export interface CaseListResponse {
  tab: CaseTab
  cases: CaseListItem[]
  total: number
  /** Scoped by `tab` only, so the status tabs stay comparable to each other. */
  statusCounts: CaseStatusCounts
  page: number
  limit: number
}

/** GET /api/admin/case response; `now` is the server clock for waiting-time display. */
export interface AdminCaseListResponse {
  cases: AdminCaseListItem[]
  total: number
  /** Scoped by kind and search only, so closed statuses are counted as well. */
  statusCounts: CaseStatusCounts
  page: number
  limit: number
  now: string
}

export interface CaseDetailResponse {
  case: CaseDetail
}

export interface CaseCreateResponse {
  case: CaseSummary
  created: boolean
  subscribed: boolean
  justClosed?: boolean
}

export interface CaseMessageResponse {
  message: CaseMessage | null
  case: CaseSummary
}

export interface CaseActionResponse {
  case: CaseSummary
  changed: boolean
  message?: CaseMessage | null
}

export interface CaseReopenConflictResponse {
  conflict: true
  existingCaseId: number
}

export type CaseReopenResponse = CaseActionResponse | CaseReopenConflictResponse

export interface CaseResourceActionResponse extends CaseActionResponse {
  action: 'hide' | 'restore' | 'move'
  fromPatchId?: number
  toPatchId?: number
}

export interface CaseContentActionResponse extends CaseActionResponse {
  action: 'delete' | 'takedown' | 'restore'
  targetMissing?: boolean
}

export interface AdminCaseInboxPayload {
  id: number
  kind: CaseKind
  targetType: CaseTargetType
  targetId: number
  target: CaseTargetSummary
  patchId: number | null
  ownerType: 'staff'
  status: CaseStatus
  resolution: CaseResolution | null
  subscriberCount: number
  created: string
  statusChangedAt: string
  queueEnteredAt: string
}

export interface CaseInboxItem {
  key: `case:${number}`
  kind: 'case'
  id: number
  title: string
  subtitle: string
  actor: CaseActorSummary | null
  waitingFrom: string
  waitingSeconds: number
  targetHref: string
  badges: string[]
  readOnly: false
  payload: AdminCaseInboxPayload
}

export type CaseCreateInput = {
  kind: CaseKind
  targetType: CaseTargetType
  targetId: number
  expectedPatchId?: number
  content: string
  imageKeys?: string[]
}

/** GET /api/case/pending-count, used by the site user menu (D22). */
export interface CasePendingCountResponse {
  /** Publisher-owned cases waiting on the viewer. */
  owned: number
  /** The viewer's own cases waiting for their supplement. */
  waitingReporter: number
}

/** POST /api/case/image. The key is what create/reply requests send back. */
export interface CaseImageUploadResponse {
  key: string
  url: string
}
