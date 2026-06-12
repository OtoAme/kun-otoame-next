import { Suspense } from 'react'
import { TagDetailContainer } from '~/components/tag/detail/Container'
import { generateKunMetadataTemplate } from './metadata'
import { getCachedTagById } from './data'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import type { Metadata } from 'next'
import { prisma } from '~/prisma/index'
import { STATIC_TAG_PREGEN_LIMIT } from '~/config/staticGeneration'

export const revalidate = 300
export const dynamic = 'force-static'

interface Props {
  params: Promise<{ id: string }>
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

export async function generateStaticParams() {
  if (STATIC_TAG_PREGEN_LIMIT === 0) {
    return []
  }

  const tags = await prisma.patch_tag.findMany({
    orderBy: { count: 'desc' },
    take: STATIC_TAG_PREGEN_LIMIT,
    select: { id: true }
  })

  return tags.map((tag) => ({
    id: String(tag.id)
  }))
}

export default async function Kun({ params }: Props) {
  const { id } = await params
  const tagId = Number(id)

  const tag = await getCachedTagById(tagId)

  if (typeof tag === 'string') {
    return <ErrorComponent error={tag} />
  }

  return (
    <Suspense>
      <KunBreadcrumbTitle routeKey={`/tag/${tag.id}`} title={tag.name} />
      <TagDetailContainer
        initialTag={tag}
        initialGalgames={[]}
        initialTotal={0}
      />
    </Suspense>
  )
}
