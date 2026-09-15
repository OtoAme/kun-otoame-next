'use client'

import type { InboxItem } from '~/types/api/inbox'
import { DashboardCaseDetail } from './DashboardCaseDetail'

type CaseInboxItem = Extract<InboxItem, { kind: 'case' }>

interface CaseInboxDetailProps {
  item: CaseInboxItem
  onProcessed: (key: string) => void
  onStateChanged: (key: string) => void
}

export function CaseInboxDetail({
  item,
  onProcessed,
  onStateChanged
}: CaseInboxDetailProps) {
  return (
    <DashboardCaseDetail
      caseId={item.id}
      onProcessed={() => onProcessed(item.key)}
      onStateChanged={() => onStateChanged(item.key)}
    />
  )
}
