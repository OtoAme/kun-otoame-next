import { redirect } from 'next/navigation'
import { prisma } from '~/prisma/index'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { HelpPostForm } from '~/components/help/HelpPostForm'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { resolveHelpCreatePreset } from './preset'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = { title: '发布求助' }

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * `?patch=<uniqueId>&resource=<id>` prefills the game link from a game page
 * or resource card. A missing card follows the merge mapping to the
 * survivor's current game. The values are only suggestions; submit checks
 * them again.
 */
export default async function HelpCreatePage({ searchParams }: Props) {
  const payload = await verifyHeaderCookie()
  if (!payload) redirect('/login')
  const params = await searchParams
  const rawPatch = typeof params.patch === 'string' ? params.patch : ''
  const rawResource = typeof params.resource === 'string' ? params.resource : ''
  const { presetPatch, presetResourceId } = await resolveHelpCreatePreset(
    {
      $queryRaw: (query) => prisma.$queryRaw(query),
      patch: {
        findFirst: (args) => prisma.patch.findFirst(args)
      },
      patch_resource: {
        findUnique: (args) => prisma.patch_resource.findUnique(args),
        findFirst: (args) => prisma.patch_resource.findFirst(args)
      }
    },
    {
      patchUniqueId: rawPatch,
      resourceRaw: rawResource,
      visibilityWhere: await getPatchVisibilityWhere()
    }
  )
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
