import { Container } from '~/components/tag/Container'
import { kunMetadata } from './metadata'
import { getTag } from '~/app/api/tag/service'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { Suspense } from 'react'
import type { Metadata } from 'next'

export const revalidate = 300

export const metadata: Metadata = kunMetadata

export default async function Kun() {
  const response = await getTag({
    page: 1,
    limit: 100
  })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <Suspense>
      <Container
        initialTags={response.tags}
        initialTotal={response.total}
      />
    </Suspense>
  )
}
