import { Report } from '~/components/admin/report/Container'
import { kunMetadata } from './metadata'
import { kunGetActions } from './actions'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import type { AdminLegacyReport } from '~/types/api/admin'

export const revalidate = 0

export const metadata: Metadata = kunMetadata

export default async function Kun() {
  const response = await kunGetActions({
    page: 1,
    limit: 30,
    tab: 'pending',
    targetType: 'comment'
  })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  // This page queries targetType 'comment' only; shoutbox reports are
  // reviewed in the console, so the legacy table consumes legacy rows.
  const legacyReports = response.reports.filter(
    (report): report is AdminLegacyReport => report.targetType !== 'shoutbox'
  )

  return (
    <Suspense>
      <Report
        initialReports={legacyReports}
        total={response.total}
        title="评论举报管理"
        targetType="comment"
      />
    </Suspense>
  )
}
