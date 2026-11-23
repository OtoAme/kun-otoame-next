import { CardContainer } from '~/components/galgame/Container'
import { kunMetadata } from './metadata'
import { Suspense } from 'react'
import { getGalgame } from '~/app/api/otomegame/service'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import type { Metadata } from 'next'
import {
  getGalgamePageState,
  type GalgameSearchParams
} from '~/utils/actions/getGalgamePageState'
import { DEFAULT_GALGAME_MIN_RATING_COUNT } from '~/utils/galgameFilter'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = kunMetadata

export default async function Kun({
  searchParams
}: {
  searchParams: Promise<GalgameSearchParams>
}) {
  const state = await getGalgamePageState(
    await searchParams,
    DEFAULT_GALGAME_MIN_RATING_COUNT
  )
  if (typeof state === 'string') return <ErrorComponent error={state} />
  const response = await getGalgame(state.input, state.visibility)
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <Suspense>
      <CardContainer
        key={JSON.stringify([state.scope, state.filters])}
        initialGalgames={response.galgames}
        initialTotal={response.total}
        initialScope={state.scope}
        initialFilters={state.filters}
      />
    </Suspense>
  )
}
