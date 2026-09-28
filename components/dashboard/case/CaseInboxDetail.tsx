'use client'

import { CASE_WAITING_HANDLER_STATUSES } from '~/constants/case'
import type { InboxItem } from '~/types/api/inbox'
import type { CaseSummary } from '~/types/api/case'

import { DashboardCaseDetail } from './DashboardCaseDetail'

type CaseInboxItem = Extract<InboxItem, { kind: 'case' }>

interface CaseInboxDetailProps {
  item: CaseInboxItem
  onProcessed: (key: string) => void
}

/**
 * A staff case inside the unified inbox. It renders the case center's own
 * detail, so replying, closing and moderation work here too (review item 2).
 *
 * The inbox only queues cases waiting on the handler (D23): a closure, or a
 * reply that hands the case to its reporter, takes it out like any processed
 * item. Anything else leaves the case in place. The detail reloads itself,
 * whereas the inbox's conflict refresh would remount it and drop the
 * administrator's drafts, open dialog and error message.
 */
export function CaseInboxDetail({ item, onProcessed }: CaseInboxDetailProps) {
  const handleStateChanged = (updated?: CaseSummary) => {
    if (
      updated &&
      !(CASE_WAITING_HANDLER_STATUSES as readonly string[]).includes(
        updated.status
      )
    ) {
      onProcessed(item.key)
    }
  }

  return (
    <DashboardCaseDetail
      caseId={item.id}
      onProcessed={() => onProcessed(item.key)}
      onStateChanged={handleStateChanged}
    />
  )
}
