import { notFound } from 'next/navigation'
import { CaseDetailContainer } from '~/components/case/CaseDetailContainer'
import { IssueLoginRequired } from '~/components/case/IssueLoginRequired'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { kunMetadata } from '../metadata'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

export const revalidate = 0

export default async function IssueDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const caseId = Number(id)
  if (!Number.isSafeInteger(caseId) || caseId < 1) {
    notFound()
  }

  const payload = await verifyHeaderCookie()
  if (!payload) {
    return (
      <IssueLoginRequired
        title="问题处理"
        description="登录后才能查看问题详情。"
      />
    )
  }

  return <CaseDetailContainer caseId={caseId} />
}
