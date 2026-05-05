import { CardContainer } from '~/components/galgame/Container'
import { kunMetadata } from './metadata'
import { Suspense } from 'react'
import { getGalgame } from '~/app/api/otomegame/service'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import type { Metadata } from 'next'

export const revalidate = 180

export const metadata: Metadata = kunMetadata

export default async function Kun() {
  const response = await getGalgame(
    {
      selectedType: 'all',
      selectedLanguage: 'all',
      selectedPlatform: 'all',
      sortField: 'resource_update_time',
      sortOrder: 'desc',
      page: 1,
      limit: 24,
      yearString: JSON.stringify(['all']),
      monthString: JSON.stringify(['all']),
      minRatingCount: 0
    },
    { content_limit: 'sfw' }
  )
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <Suspense>
      <CardContainer
        initialGalgames={response.galgames}
        initialTotal={response.total}
      />
    </Suspense>
  )
}
