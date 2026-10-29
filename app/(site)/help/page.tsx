import { redirect } from 'next/navigation'
import { listHelpPosts } from '~/app/api/help/service'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { HelpListContainer } from '~/components/help/HelpListContainer'
import {
  HELP_CATEGORIES,
  HELP_PAGE_SIZE,
  HELP_SCOPES,
  type HelpCategory,
  type HelpScope
} from '~/constants/help'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import type { HelpListResponse } from '~/types/api/help'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = {
  title: '求助区',
  description: '向社区求助运行、下载、解压问题，求游戏或资源'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const pick = <T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[]
): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined

/**
 * `?category=` and `?scope=mine|followed` deep-link into the list, e.g. the
 * sidebar's 查看全部. Own scopes need a session; guests go to login.
 */
export default async function HelpPage({ searchParams }: Props) {
  const params = await searchParams
  const category = pick<HelpCategory>(params.category, HELP_CATEGORIES)
  const scope: HelpScope = pick(params.scope, HELP_SCOPES) ?? 'all'
  const payload = await verifyHeaderCookie()
  if (scope !== 'all' && !payload) redirect('/login')
  let initial: HelpListResponse | null = null
  try {
    initial = await listHelpPosts(
      { page: 1, limit: HELP_PAGE_SIZE, sort: 'latest', category, scope },
      await getPatchVisibilityWhere(),
      { viewer: payload ? { uid: payload.uid, role: payload.role } : null }
    )
  } catch {
    initial = null
  }
  return (
    <>
      <KunBreadcrumbTitle routeKey="/help" title="求助区" />
      <HelpListContainer
        key={`${category ?? 'all'}:${scope}`}
        initial={initial}
        initialCategory={category}
        initialScope={scope}
        signedIn={Boolean(payload)}
      />
    </>
  )
}
