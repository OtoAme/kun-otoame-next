import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { IssueCaseDetail } from '~/components/dashboard/issue/IssueCaseDetail'
import { Button } from '~/components/dashboard/ui/button'

export default async function WorkspaceIssueDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const caseId = Number(id)
  if (
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(caseId) ||
    caseId > 2147483647
  ) {
    notFound()
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-3">
      <Button asChild variant="ghost" size="sm">
        <Link href="/workspace/issues">
          <ArrowLeft className="size-4" aria-hidden />
          返回问题处理
        </Link>
      </Button>
      <IssueCaseDetail caseId={caseId} />
    </div>
  )
}
