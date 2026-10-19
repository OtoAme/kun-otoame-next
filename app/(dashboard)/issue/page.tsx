import { redirect } from 'next/navigation'
import {
  workspaceIssueRedirect,
  type WorkspaceSearchParams
} from '~/utils/workspaceRoutes'

export default async function IssuePage({
  searchParams
}: {
  searchParams: Promise<WorkspaceSearchParams>
}) {
  redirect(workspaceIssueRedirect(await searchParams))
}
