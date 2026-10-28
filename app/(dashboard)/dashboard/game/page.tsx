import type { Metadata } from 'next'
import { DashboardGames } from '~/components/dashboard/game/DashboardGames'
import { requireDashboardUser } from '~/lib/dashboard/auth'

export const metadata: Metadata = { title: '游戏条目' }

export default async function DashboardGamesPage() {
  const currentUser = await requireDashboardUser()
  return <DashboardGames viewerRole={currentUser.role} />
}
