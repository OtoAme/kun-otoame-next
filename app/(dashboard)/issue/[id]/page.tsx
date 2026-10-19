import { notFound, redirect } from 'next/navigation'
import {
  workspaceIssueRedirect,
  type WorkspaceSearchParams
} from '~/utils/workspaceRoutes'

export default async function IssueDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<WorkspaceSearchParams>
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
  redirect(workspaceIssueRedirect(await searchParams, caseId))
}
