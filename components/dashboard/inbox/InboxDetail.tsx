import type { InboxItem } from '~/types/api/inbox'

import { LegacyInboxDetail } from './LegacyInboxDetail'
import { ResourceInboxDetail } from './ResourceInboxDetail'
import { SubmissionInboxDetail } from './SubmissionInboxDetail'

export interface InboxDetailProps {
  item: InboxItem
  reviewerId: number
  reviewerRole: number
  onProcessed: (key: string) => void
  onStateChanged: (key: string) => void
}

export function InboxDetail({
  item,
  reviewerId,
  reviewerRole,
  onProcessed,
  onStateChanged
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
        />
      )
    case 'resource-apply':
      return (
        <ResourceInboxDetail
          item={item}
          onProcessed={onProcessed}
          onStateChanged={onStateChanged}
        />
      )
    case 'feedback':
    case 'report':
      return <LegacyInboxDetail item={item} />
  }
}
