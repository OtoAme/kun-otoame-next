import type { CaseStatus } from '~/types/api/case'

export type CaseBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'

/** Shared so a queue row and the detail header never disagree on a status. */
export const CASE_STATUS_BADGE_VARIANTS: Record<CaseStatus, CaseBadgeVariant> =
  {
    open: 'default',
    waiting_owner: 'default',
    waiting_reporter: 'secondary',
    resolved: 'outline',
    rejected: 'destructive',
    merged: 'outline'
  }
