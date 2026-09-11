import { redirect } from 'next/navigation'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

export const requireDashboardUser = async () => {
  const user = await verifyHeaderCookie()
  if (!user) redirect('/login')
  if (user.role < 3) redirect('/')
  return { id: user.uid, name: user.name, role: user.role }
}
