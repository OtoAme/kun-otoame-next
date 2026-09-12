import { getShoutboxList } from '~/app/api/shoutbox/service'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { ShoutboxContainer } from '~/components/shoutbox/ShoutboxContainer'
import { SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import type { ShoutboxListResponse } from '~/types/api/shoutbox'
import type { Metadata } from 'next'
import type { Prisma } from '@prisma/client'

export const revalidate = 0

export const metadata: Metadata = {
  title: '小喇叭'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// The SSR context handed to the client is derived from the actual where
// clause applied to this read, not from a second cookie-reading code path:
// getNSFWHeader only omits content_limit for "all", and buildBlockedTagWhere
// only emits the NOT.tag.some.tag_id.in shape with a sorted id list.
const readNsfwFromWhere = (where: Prisma.patchWhereInput): string =>
  typeof where.content_limit === 'string' ? where.content_limit : 'all'

const readBlockedTagsFromWhere = (where: Prisma.patchWhereInput): number[] => {
  const not = where.NOT
  const clause = Array.isArray(not) ? not[0] : not
  const some = clause?.tag?.some
  const tagId = some && typeof some === 'object' ? some.tag_id : undefined
  const list =
    tagId && typeof tagId === 'object' && 'in' in tagId ? tagId.in : undefined
  return Array.isArray(list)
    ? list.filter(
        (id): id is number =>
          typeof id === 'number' && Number.isInteger(id) && id > 0
      )
    : []
}

export default async function ShoutboxPage({ searchParams }: Props) {
  const params = await searchParams
  const rawPatch = params.patch
  const patchUniqueId =
    typeof rawPatch === 'string' && /^[A-Za-z0-9]{8}$/.test(rawPatch)
      ? rawPatch
      : undefined

  // One preference read per request (the helpers are React-cache memoized):
  // the SSR page is personalized with the same context the key records. A
  // failure anywhere falls back to no seed at all, and the client simply
  // fetches once it is ready.
  let initialData: ShoutboxListResponse | null = null
  let initialContext = { uid: 0, nsfw: 'sfw', blockedTags: [] as number[] }
  try {
    const payload = await verifyHeaderCookie()
    const visibilityWhere = await getPatchVisibilityWhere()
    initialContext = {
      uid: payload?.uid ?? 0,
      nsfw: readNsfwFromWhere(visibilityWhere),
      blockedTags: readBlockedTagsFromWhere(visibilityWhere)
    }
    initialData = await getShoutboxList(
      {
        page: 1,
        limit: SHOUTBOX_PAGE_SIZE,
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
        initialContext={initialContext}
      />
    </div>
  )
}
