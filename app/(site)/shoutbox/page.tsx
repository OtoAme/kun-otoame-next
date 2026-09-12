import { getShoutboxList } from '~/app/api/shoutbox/service'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { ShoutboxContainer } from '~/components/shoutbox/ShoutboxContainer'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import type { ShoutboxListResponse } from '~/types/api/shoutbox'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = {
  title: '小喇叭'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ShoutboxPage({ searchParams }: Props) {
  const params = await searchParams
  const rawPatch = params.patch
  const patchUniqueId =
    typeof rawPatch === 'string' && /^[A-Za-z0-9]{8}$/.test(rawPatch)
      ? rawPatch
      : undefined

  // The server-rendered first page already uses the cookie-aware visibility
  // helper, so it is personalized. The client container still refreshes once
  // on mount because the shared list payload is cached for a short base
  // duration and can lag a fresh publish or a just-crossed time boundary.
  let initialData: ShoutboxListResponse | null = null
  try {
    const visibilityWhere = await getPatchVisibilityWhere()
    initialData = await getShoutboxList(
      {
        page: 1,
        limit: 6,
        ...(patchUniqueId ? { patch: patchUniqueId } : {})
      },
      { visibilityWhere }
    )
  } catch {
    initialData = null
  }

  return (
    <div className="container mx-auto my-4 max-w-3xl space-y-6">
      <KunBreadcrumbTitle routeKey="/shoutbox" title="小喇叭" />
      <ShoutboxContainer
        key={patchUniqueId ?? 'all'}
        initialData={initialData}
        patchUniqueId={patchUniqueId}
      />
    </div>
  )
}
