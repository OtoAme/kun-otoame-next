import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { IssueCaseDetail } from '~/components/dashboard/issue/IssueCaseDetail'
import { Button } from '~/components/dashboard/ui/button'

/** 通知与站内链接的深链落点；工作区内选中另走 /issue?id=N, 不重挂列表。 */
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Button asChild variant="ghost" size="sm">
        <Link href="/issue">
          <ArrowLeft className="size-4" aria-hidden />
          返回问题处理
        </Link>
      </Button>
      <IssueCaseDetail caseId={caseId} />
    </div>
  )
}
