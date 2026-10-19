import type {
  LINK_MAINTENANCE_ACTIONS,
  LINK_MAINTENANCE_OUTCOMES,
  LINK_MAINTENANCE_STATES
} from '~/constants/linkMaintenance'
import type {
  LinkHealthBasis,
  LinkHealthSummary,
  LinkHealthView,
  LinkTarget
} from './linkHealth'

export type LinkMaintenanceState = (typeof LINK_MAINTENANCE_STATES)[number]
export type LinkMaintenanceAction = (typeof LINK_MAINTENANCE_ACTIONS)[number]
export type LinkMaintenanceOutcome = (typeof LINK_MAINTENANCE_OUTCOMES)[number]

/** Public, version-scoped restriction. It contains no conversation or identity. */
export interface LinkMaintenanceRestriction {
  revision: number
  restriction: 'snoozed' | 'stopped' | null
  resumesAt: string | null
}

/** Reports return the committed notification outcome, independently of caseId. */
export interface LinkMaintenanceReportReceipt {
  event: 'opened' | 'merged' | 'none'
  publisherNotified: boolean
}

/** Private author DTO; never attach this to a public resource response. */
export interface LinkMaintenanceItem extends LinkTarget {
  eventId: number | null
  round: number | null
  maintenanceRevision: number
  state: LinkMaintenanceState
  snoozedUntil: string | null
  openedAt: string | null
  respondedAt: string | null
  response: {
    outcome: LinkMaintenanceOutcome
    note: string
    created: string
  } | null
  reportCount: number
  /** Only a case the current viewer is authorized to read. */
  caseId: number | null
  patch: { uniqueId: string; name: string }
  resource: { name: string; section: string }
  storage: string
  health: LinkHealthSummary
  capabilities: { actions: LinkMaintenanceAction[] }
}

type MaintenanceExpectedTarget = LinkTarget & { maintenanceRevision: number }

export type LinkMaintenanceActionInput = MaintenanceExpectedTarget &
  (
    | { action: 'respond'; note: string }
    | { action: 'verify'; note: string; basis: LinkHealthBasis }
    | { action: 'snooze'; days: 1 | 3 }
    | { action: 'stop'; note: string }
    | { action: 'resume' }
  )

export interface LinkMaintenanceActionResponse {
  item: LinkMaintenanceItem
  link: LinkHealthView
  changed: boolean
  notifiedCount: number
}

export interface LinkMaintenanceListResponse {
  items: LinkMaintenanceItem[]
  total: number
  page: number
  limit: number
  /** Same predicate as pending-count: pending, including expired snoozes. */
  actionableCount: number
}
