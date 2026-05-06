import { Suspense } from 'react'
import { TagDetailContainer } from '~/components/tag/detail/Container'
import { generateKunMetadataTemplate } from './metadata'
import { kunGetTagByIdActions } from './actions'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import type { Metadata } from 'next'

export const revalidate = 300
export const dynamic = 'force-static'

interface Props {
  params: Promise<{ id: string }>
}

export const generateMetadata = async ({
  params
}: Pick<Props, 'params'>): Promise<Metadata> => {
  const { id } = await params
  const tag = await kunGetTagByIdActions({ tagId: Number(id) })

  if (typeof tag === 'string') {
    return generateKunMetadataTemplate('标签详情')
  }

  return generateKunMetadataTemplate(tag.name)
}

export default async function Kun({ params }: Props) {
  const { id } = await params

  const tag = await kunGetTagByIdActions({ tagId: Number(id) })
  if (typeof tag === 'string') {
    return <ErrorComponent error={tag} />
  }

  return (
    <Suspense>
      <KunBreadcrumbTitle routeKey={`/tag/${tag.id}`} title={tag.name} />
      <TagDetailContainer initialTag={tag} />
    </Suspense>
  )
}
