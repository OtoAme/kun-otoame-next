import { redirect } from 'next/navigation'

import { DashboardStats } from '~/components/dashboard/DashboardStats'
import { requireDashboardUser } from '~/lib/dashboard/auth'

const INBOX_PARAM_KEYS = ['kinds', 'kind', 'id', 'search', 'order'] as const

// First screen is the stats overview. Any legacy inbox param (even empty or
// repeated) forwards to /dashboard/inbox with the full query preserved.
export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const currentUser = await requireDashboardUser()
  const params = await searchParams
  if (INBOX_PARAM_KEYS.some((key) => key in params)) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) query.append(key, item)
      } else {
        query.append(key, value)
      }
    }
    redirect(`/dashboard/inbox?${query.toString()}`)
  }
  return <DashboardStats reviewerRole={currentUser.role} />
}
