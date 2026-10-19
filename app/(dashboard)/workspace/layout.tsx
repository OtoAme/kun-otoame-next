import type { Metadata } from 'next'
import { WorkspaceShell } from '~/components/dashboard/workspace/WorkspaceShell'
import { requireWorkspaceUser } from '~/lib/workspace/auth'

export const metadata: Metadata = {
  title: { absolute: '用户工作台' },
  robots: { index: false, follow: false, nocache: true, noimageindex: true }
}

export const revalidate = 0

export default async function WorkspaceLayout({
  children
}: {
  children: React.ReactNode
}) {
  const user = await requireWorkspaceUser()
  return <WorkspaceShell user={user}>{children}</WorkspaceShell>
}
