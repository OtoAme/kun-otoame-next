import type { z } from 'zod'
import type {
  LINK_CASE_RESOLUTIONS,
  LINK_CHECK_PROVIDERS,
  LINK_CHECK_REASONS,
  LINK_CHECK_VERDICTS,
  LINK_DISPUTE_SOURCES,
  LINK_HEALTH_ERRORS,
  LINK_HEALTH_OWNER_ACTIONS,
  LINK_HEALTH_RESOLVE_ACTIONS,
  LINK_HEALTH_STATES,
  LINK_REPORT_REASONS
} from '~/constants/linkHealth'
import type {
  adminLinkHealthQuerySchema,
  linkCaseContextSchema,
  linkCheckRequestSchema,
  linkHealthActionSchema,
  linkHealthQuerySchema,
  linkHealthResolveSchema,
  linkReportSchema
} from '~/validations/linkHealth'

export type LinkHealth = (typeof LINK_HEALTH_STATES)[number]
export type LinkReportReason = (typeof LINK_REPORT_REASONS)[number]
export type LinkCheckVerdict = (typeof LINK_CHECK_VERDICTS)[number]
export type LinkCheckProvider = (typeof LINK_CHECK_PROVIDERS)[number]
export type LinkCheckReason = (typeof LINK_CHECK_REASONS)[number]
export type LinkDisputeSource = (typeof LINK_DISPUTE_SOURCES)[number]
export type LinkCaseResolution = keyof typeof LINK_CASE_RESOLUTIONS
export type LinkHealthErrorCode = keyof typeof LINK_HEALTH_ERRORS
export type LinkHealthError =
  (typeof LINK_HEALTH_ERRORS)[LinkHealthErrorCode]['message']
export type LinkHealthApiResult<T> = T | LinkHealthError

export type LinkReportRequest = z.output<typeof linkReportSchema>
export type LinkHealthActionRequest = z.output<typeof linkHealthActionSchema>
export type LinkHealthResolveRequest = z.output<typeof linkHealthResolveSchema>
export type LinkCheckRequest = z.output<typeof linkCheckRequestSchema>
export type LinkHealthQuery = z.output<typeof linkHealthQuerySchema>
export type AdminLinkHealthQuery = z.output<typeof adminLinkHealthQuerySchema>

/** Complete edit baseline, including links that will be removed. */
export interface LinkVersionBase {
  id: number
  version: number
}

export interface LinkTarget {
  patchId: number
  resourceId: number
  linkId: number
  linkVersion: number
}

/** Captured before I/O and compared again under the link lock. */
export interface LinkHealthBasis extends LinkTarget {
  evidenceRound: number
  health: LinkHealth
  healthChangedAt: string | null
}

export type LinkCheckObservation =
  | {
      verdict: 'available'
      provider: LinkCheckProvider
      reason: 'share_available'
    }
  | {
      verdict: 'broken'
      provider: LinkCheckProvider
      reason: 'share_deleted' | 'share_cancelled' | 'share_expired'
    }
  | {
      verdict: 'unknown'
      provider: LinkCheckProvider | null
      reason: Exclude<LinkCheckReason, `share_${string}`>
    }

export type LinkCheckResult =
  | (LinkCheckObservation & { failed: false; checkedAt: string })
  | (Extract<LinkCheckObservation, { verdict: 'unknown' }> & {
      failed: true
      checkedAt: null
    })

/** Safe public projection; failed attempts never invent a checkedAt. */
export type LinkCheckSummary = LinkCheckResult & {
  attemptedAt: string
  stale: boolean
}

export interface LinkHealthCapabilities {
  ownerActions: (typeof LINK_HEALTH_OWNER_ACTIONS)[number][]
  resolveActions: (typeof LINK_HEALTH_RESOLVE_ACTIONS)[number][]
  canCheck: boolean
  canEdit: boolean
}

/** Attached to each public link; no addresses, codes or reporter identities. */
export interface LinkHealthSummary {
  version: number
  evidenceRound: number
  health: LinkHealth
  healthChangedAt: string | null
  verifiedAt: string | null
  lastRelinkAt: string | null
  ownerType: 'publisher' | 'staff'
  disputeSource: LinkDisputeSource | null
  /** Current address version, last 72 hours, distinct users across rounds. */
  recentReportCount: number
  latestCheck: LinkCheckSummary | null
  capabilities: LinkHealthCapabilities
}

export type LinkHealthView = Omit<LinkTarget, 'linkVersion'> & LinkHealthSummary

export interface LinkHealthMutationResponse {
  link: LinkHealthView
  /** Health changed; saving a report or a snapshot alone leaves this false. */
  changed: boolean
}

export interface LinkReportResponse extends LinkHealthMutationResponse {
  /** Duplicate is a successful no-op; zero weight is still a saved report. */
  report: 'recorded' | 'renewed' | 'duplicate'
  weight: 0 | 0.5 | 1
  /** Null means this request did not leave an unresolved link case. */
  caseId: number | null
}

export interface LinkCheckResponse extends LinkHealthMutationResponse {
  check: 'observed' | 'failed'
}

export interface LinkHealthListRow extends LinkHealthView {
  patch: { uniqueId: string; name: string }
  resource: { name: string; section: string }
  storage: string
  size: string
  hostname: string | null
  brokenForSeconds: number | null
  caseId: number | null
}

export interface LinkHealthListResponse {
  items: LinkHealthListRow[]
  total: number
  page: number
  limit: number
}

export interface AdminLinkHealthListResponse extends LinkHealthListResponse {
  /** Actual batch activation instant, not the time of this query. */
  trackingStartedAt: string | null
  hosts: {
    hostname: string | null
    totalLinks: number
    brokenLinks: number
  }[]
}

/** Server-only identity: never serialize inputSignature into an API payload. */
export interface LinkCheckIdentity {
  requestId: string
  basis: LinkHealthBasis
  inputSignature: string
  requestedAt: string
}

/** One latest row per link, Cascade on link removal; no raw checker response. */
export type LinkCheckSnapshot = LinkCheckIdentity &
  LinkCheckResult & {
    completedAt: string
    cached: boolean
  }

/** payload.link_health on system case messages; read the latest context only. */
export type LinkCaseContext = z.output<typeof linkCaseContextSchema>

export interface OpenLinkCaseInput {
  context: LinkCaseContext
  /** Real reporters only, selected by the health service in the transaction. */
  reporterIds: number[]
  now: Date
}

export interface OpenLinkCaseResult {
  caseId: number
  created: boolean
  changed: boolean
}

export type CloseLinkCasesInput = (
  | { resourceIds: readonly number[]; linkIds?: never; targets?: never }
  | { linkIds: readonly number[]; resourceIds?: never; targets?: never }
  | {
      targets: readonly Pick<LinkTarget, 'linkId' | 'linkVersion'>[]
      resourceIds?: never
      linkIds?: never
    }
) & {
  resolution: LinkCaseResolution
  actorType: 'system' | 'publisher' | 'staff'
  actorId?: number | null
  now: Date
}

export interface CloseLinkCasesResult {
  closedCaseIds: number[]
}

/** Safe history payload for reason=health; the CAS winner writes it once. */
export interface LinkHealthTransitionRecord {
  from: LinkHealthBasis
  to: Pick<LinkHealthBasis, 'evidenceRound' | 'health' | 'healthChangedAt'>
  cause: 'user_reports' | LinkDisputeSource | LinkCaseResolution
  machine: Pick<LinkCheckSnapshot, 'provider' | 'reason' | 'checkedAt'> | null
}
