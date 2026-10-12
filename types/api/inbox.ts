import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'
import type {
  AdminFeedback,
  AdminLegacyReport,
  AdminResource,
  AdminShoutboxReport
} from './admin'
import type { AdminCaseInboxPayload } from './case'
import { BROKEN_LINK_INBOX_KIND } from '~/constants/linkHealth'
import type { LinkHealthListRow } from './linkHealth'

export const INBOX_KINDS = [
  'submission',
  'resource-apply',
  'feedback',
  'report',
  'case',
  'broken-link'
] as const

export type InboxKind = (typeof INBOX_KINDS)[number]
export type InboxOrder = 'waiting' | 'kind'

export type InboxPayloads = {
  submission: AdminSubmissionRow
  'resource-apply': AdminResource
  feedback: AdminFeedback
  report:
    | (AdminLegacyReport & { pendingForTarget: number })
    | (AdminShoutboxReport & { pendingForTarget: number })
  case: AdminCaseInboxPayload
  'broken-link': BrokenLinkInboxPayload
}

export type InboxItem = {
  [K in InboxKind]: {
    key: `${K}:${number}`
    kind: K
    id: number
    title: string
    subtitle: string
    actor: { id: number; name: string; avatar?: string } | null
    waitingFrom: string
    waitingSeconds: number
    targetHref: string
    badges: string[]
    readOnly: boolean
    payload: InboxPayloads[K]
  }
}[InboxKind]

export interface InboxQuery {
  kinds: InboxKind[]
  search: string
  order: InboxOrder
  limitPerKind: number
}

export interface InboxListResponse {
  items: InboxItem[]
  totals: Record<InboxKind, number>
  truncated: Record<InboxKind, boolean>
}

export type InboxItemResponse =
  | { state: 'pending' | 'processed'; item: InboxItem }
  | { state: 'missing' | 'processed'; item: null }

export interface InboxCounts {
  pending: Record<InboxKind, number>
  todayProcessed: number
}

/** W04-health activates this vocabulary with all inbox readers and UI. */
export const LINK_HEALTH_INBOX_KINDS = INBOX_KINDS
export type LinkHealthInboxKind = (typeof LINK_HEALTH_INBOX_KINDS)[number]

/** Only touchgal + broken + no unresolved link case is pending here. */
export interface BrokenLinkInboxPayload {
  link: LinkHealthListRow & { storage: 'touchgal'; health: 'broken' }
  /** Both actions hydrate the existing resource editor and use its baseline. */
  actions: { relink: true; remove: boolean }
}

export type BrokenLinkInboxItem = Omit<
  Extract<InboxItem, { kind: 'case' }>,
  'key' | 'kind' | 'payload'
> & {
  key: `broken-link:${number}`
  kind: typeof BROKEN_LINK_INBOX_KIND
  /** Link ID, never the resource or case ID. */
  id: number
  payload: BrokenLinkInboxPayload
}

export type LinkHealthInboxItem = InboxItem | BrokenLinkInboxItem
export interface LinkHealthInboxQuery extends Omit<InboxQuery, 'kinds'> {
  kinds: LinkHealthInboxKind[]
}
export interface LinkHealthInboxListResponse {
  items: LinkHealthInboxItem[]
  totals: Record<LinkHealthInboxKind, number>
  truncated: Record<LinkHealthInboxKind, boolean>
}
export type LinkHealthInboxItemResponse =
  | { state: 'pending' | 'processed'; item: LinkHealthInboxItem }
  | { state: 'missing' | 'processed'; item: null }
export interface LinkHealthInboxCounts {
  pending: Record<LinkHealthInboxKind, number>
  todayProcessed: number
}
