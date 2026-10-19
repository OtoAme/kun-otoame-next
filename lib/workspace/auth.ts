import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import type { WorkspaceUser } from '~/types/api/workspace'

export const requireWorkspaceUser = async (): Promise<WorkspaceUser> => {
  const user = await verifyHeaderCookie()
  if (!user) redirect('/login')
  return { id: user.uid, name: user.name, role: user.role }
}
