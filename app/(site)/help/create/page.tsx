import { redirect } from 'next/navigation'
import { prisma } from '~/prisma/index'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { HelpPostForm } from '~/components/help/HelpPostForm'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import type { HelpPatchLink } from '~/types/api/help'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = { title: '发布求助' }

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * `?patch=<uniqueId>&resource=<id>` prefills the game link from a game page
 * or resource card. The values are only suggestions; the server checks them
 * again on submit.
 */
export default async function HelpCreatePage({ searchParams }: Props) {
  const payload = await verifyHeaderCookie()
  if (!payload) redirect('/login')
  const params = await searchParams
  const rawPatch = typeof params.patch === 'string' ? params.patch : ''
  const rawResource = typeof params.resource === 'string' ? params.resource : ''
  let presetPatch: HelpPatchLink | null = null
  let presetResourceId: number | null = null
  if (/^[A-Za-z0-9]{8}$/.test(rawPatch)) {
    const patch = await prisma.patch.findUnique({
      where: { unique_id: rawPatch },
      select: { id: true, unique_id: true, name: true, status: true }
    })
    if (patch && patch.status === 0) {
      presetPatch = {
        id: patch.id,
        uniqueId: patch.unique_id,
        name: patch.name
      }
      const resourceId = Number(rawResource)
      if (Number.isSafeInteger(resourceId) && resourceId > 0) {
        const resource = await prisma.patch_resource.findUnique({
          where: { id: resourceId },
          select: { patch_id: true, status: true }
        })
        if (resource?.patch_id === patch.id && resource.status === 0) {
          presetResourceId = resourceId
        }
      }
    }
  }
  return (
    <div className="container mx-auto my-4 max-w-3xl">
      <KunBreadcrumbTitle routeKey="/help/create" title="发布求助" />
      <HelpPostForm
        presetPatch={presetPatch}
        presetResourceId={presetResourceId}
      />
    </div>
  )
}
