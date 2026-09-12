import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'
import type {
  AdminFeedback,
  AdminLegacyReport,
  AdminResource,
  AdminShoutboxReport
} from './admin'

export const INBOX_KINDS = [
  'submission',
  'resource-apply',
  'feedback',
  'report'
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
  | { state: 'missing'; item: null }

export interface InboxCounts {
  pending: Record<InboxKind, number>
  todayProcessed: number
}
