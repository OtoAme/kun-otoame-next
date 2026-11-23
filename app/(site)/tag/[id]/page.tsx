import { Suspense } from 'react'
import { TagDetailContainer } from '~/components/tag/detail/Container'
import { generateKunMetadataTemplate } from './metadata'
import { getCachedTagById } from './data'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import type { Metadata } from 'next'
import { getPatchByTag } from '~/app/api/tag/service'
import {
  getGalgamePageState,
  type GalgameSearchParams
} from '~/utils/actions/getGalgamePageState'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<GalgameSearchParams>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { id } = await params
  const tag = await getCachedTagById(Number(id))

  if (typeof tag === 'string') {
    return generateKunMetadataTemplate('标签详情')
  }

  return generateKunMetadataTemplate(tag.name)
}

export default async function Kun({ params, searchParams }: Props) {
  const { id } = await params
  const tagId = Number(id)

  const state = await getGalgamePageState(await searchParams)
  if (typeof state === 'string') return <ErrorComponent error={state} />
  const [tag, response] = await Promise.all([
    getCachedTagById(tagId),
    state.scope.identity === 'guest'
      ? Promise.resolve({ galgames: [], total: 0 })
      : getPatchByTag({ tagId, ...state.input }, state.visibility)
  ])

  if (typeof tag === 'string') {
    return <ErrorComponent error={tag} />
  }
  if (typeof response === 'string') return <ErrorComponent error={response} />

  return (
    <Suspense>
      <KunBreadcrumbTitle routeKey={`/tag/${tag.id}`} title={tag.name} />
      <TagDetailContainer
        key={JSON.stringify([tagId, state.scope, state.filters])}
        initialTag={tag}
        initialGalgames={response.galgames}
        initialTotal={response.total}
        initialScope={state.scope}
        initialFilters={state.filters}
      />
    </Suspense>
  )
}
