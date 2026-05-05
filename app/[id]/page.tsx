import { PatchHeaderContainer } from '~/components/patch/header/Container'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { generateKunMetadataTemplate } from './metadata'
import {
  kunGetPatchPageDataActions,
  kunUpdatePatchViewsActions
} from './actions'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getNSFWHeader } from '~/utils/actions/getNSFWHeader'
import { getPatchPageTitle } from '~/utils/patch/getPatchPageTitle'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

export const revalidate = 120

const isValidPatchId = (id: string) => /^[A-Za-z0-9]{8}$/.test(id)

const isNsfwAllowed = (nsfwHeader: { content_limit?: string }) =>
  nsfwHeader.content_limit !== 'sfw'

interface Props {
  params: Promise<{ id: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { id } = await params
  if (!isValidPatchId(id)) {
    return {}
  }

  const [pageData, nsfwHeader] = await Promise.all([
    kunGetPatchPageDataActions({ uniqueId: id }),
    getNSFWHeader()
  ])
  if (typeof pageData === 'string') {
    return {}
  }

  return generateKunMetadataTemplate(
    pageData.patch,
    pageData.intro,
    isNsfwAllowed(nsfwHeader)
  )
}

export default async function Kun({ params }: Props) {
  const { id } = await params
  if (!isValidPatchId(id)) {
    notFound()
  }

  const [pageData, payload, nsfwHeader] = await Promise.all([
    kunGetPatchPageDataActions({ uniqueId: id }),
    verifyHeaderCookie(),
    getNSFWHeader()
  ])
  const nsfwAllowed = isNsfwAllowed(nsfwHeader)
  if (typeof pageData === 'string') {
    return <ErrorComponent error={pageData} />
  }

  const viewUpdateResult = await kunUpdatePatchViewsActions({
    uniqueId: id,
    currentView: pageData.patch.view
  })
  const patch =
    typeof viewUpdateResult === 'string'
      ? pageData.patch
      : { ...pageData.patch, view: pageData.patch.view + 1 }

  const isNsfwBlocked = patch.contentLimit === 'nsfw' && !nsfwAllowed

  return (
    <div className="container py-6 mx-auto space-y-6">
      <KunBreadcrumbTitle
        routeKey={`/${patch.uniqueId}`}
        title={isNsfwBlocked ? '' : getPatchPageTitle(patch)}
      />
      <PatchHeaderContainer
        patch={patch}
        intro={pageData.intro}
        uid={payload?.uid}
        nsfwAllowed={nsfwAllowed}
      />
    </div>
  )
}
