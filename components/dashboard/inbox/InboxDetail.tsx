import type { LinkHealthInboxItem } from '~/types/api/inbox'

import { CaseInboxDetail } from '~/components/dashboard/case/CaseInboxDetail'
import { BrokenLinkInboxDetail } from './BrokenLinkInboxDetail'
import { LegacyInboxDetail } from './LegacyInboxDetail'
import { ResourceInboxDetail } from './ResourceInboxDetail'
import { SubmissionInboxDetail } from './SubmissionInboxDetail'

export interface InboxDetailProps {
  item: LinkHealthInboxItem
  reviewerId: number
  reviewerRole: number
  onProcessed: (key: string) => void
  onStateChanged: (key: string, options?: { silent?: boolean }) => void
  isPhone?: boolean
}

export function InboxDetail({
  item,
  reviewerId,
  reviewerRole,
  onProcessed,
  onStateChanged,
  isPhone = false
}: InboxDetailProps) {
  switch (item.kind) {
    case 'submission':
      return (
        <SubmissionInboxDetail
          item={item}
          reviewerId={reviewerId}
          reviewerRole={reviewerRole}
          onProcessed={onProcessed}
          onStateChanged={onStateChanged}
          isPhone={isPhone}
        />
      )
    case 'resource-apply':
      return (
        <ResourceInboxDetail
          item={item}
          reviewerId={reviewerId}
          reviewerRole={reviewerRole}
          onProcessed={onProcessed}
          onStateChanged={onStateChanged}
          isPhone={isPhone}
        />
      )
    case 'feedback':
    case 'report':
      return <LegacyInboxDetail item={item} />
    case 'case':
      return <CaseInboxDetail item={item} onProcessed={onProcessed} />
    case 'broken-link':
      return <BrokenLinkInboxDetail item={item} onProcessed={onProcessed} />
  }
}
