import type {
  CaseActorType,
  CaseContentAction,
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

/** Public resource badge. It is deliberately limited to count and owner. */
export interface PatchCaseSummary {
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
}

export interface CaseMessage {
  id: number
  kind: CaseMessageKind
  event: CaseMessageEvent | null
  body: string
  author: CaseActorSummary | null
  payload?: CaseMessagePayload | null
  created: string
}

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
  latestMessage?: Pick<
    CaseMessage,
    'id' | 'kind' | 'event' | 'body' | 'created'
  > | null
  canReply: boolean
  canResolve: boolean
  canReopen: boolean
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
  canHideResource: boolean
  canRestoreResource: boolean
  canMoveResource: boolean
  canHandleContent: boolean
  canConfirmUserHandled: boolean
  /** Actions are derived from the current target state; the UI must not infer them. */
  allowedContentActions: CaseContentAction[]
  allowedResolutions: CaseResolution[]
}

export interface CaseListResponse {
  tab: CaseTab
  cases: CaseListItem[]
  total: number
  page: number
  limit: number
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
}
