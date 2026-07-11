import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { compareResources } from '~/constants/resource'
import {
  getResourceAccessViewerKey,
  getResourceAccessViewerWhere
} from './download/access/actor'
import type { ResourceAccessViewer } from './download/access/actor'
import type { PatchResource } from '~/types/api/patch'

const patchIdSchema = z.object({
  patchId: z.coerce.number().min(1).max(9999999)
})

const normalizeResourceAccessViewer = (
  viewer: number | ResourceAccessViewer
): ResourceAccessViewer =>
  typeof viewer === 'number' ? { uid: viewer } : viewer

export const getPatchResource = async (
  input: z.infer<typeof patchIdSchema>,
  viewer: number | ResourceAccessViewer
) => {
  const { patchId } = input
  const accessViewer = normalizeResourceAccessViewer(viewer)

  const data = await prisma.patch_resource.findMany({
    where: {
      patch_id: patchId,
      status: 0
    },
    include: {
      patch: { select: { unique_id: true } },
      user: {
        include: {
          _count: {
            select: { patch_resource: true }
          }
        }
      },
      links: {
        select: {
          id: true,
          storage: true,
          size: true,
          hash: true,
          sort_order: true,
          download: true
        },
        orderBy: { sort_order: 'asc' }
      },
      _count: {
        select: { like_by: true }
      },
      like_by: {
        where: {
          user_id: accessViewer.uid
        }
      }
    }
  })

  const now = new Date()
  const resourceIds = data.map((resource) => resource.id)
  const linkIds = data.flatMap((resource) =>
    resource.links.map((link) => link.id)
  )
  const actorKey = getResourceAccessViewerKey(accessViewer)
  const actorAccessWhere = getResourceAccessViewerWhere(accessViewer)
  const [activeGrants, revealedAccess] =
    actorKey && actorAccessWhere
      ? await Promise.all([
          prisma.patch_resource_access_grant.findMany({
            where: {
              actor_key: actorKey,
              resource_id: { in: resourceIds },
              expires: { gt: now }
            },
            select: { resource_id: true, expires: true }
          }),
          prisma.patch_resource_access.findMany({
            where: {
              ...actorAccessWhere,
              link_id: { in: linkIds },
              expires: { gt: now }
            },
            select: { link_id: true }
          })
        ])
      : [[], []]

  const expiresByResourceId = new Map(
    activeGrants.map((grant) => [grant.resource_id, grant.expires])
  )
  const revealedLinkIds = new Set(
    revealedAccess.map((access) => access.link_id)
  )

  const resources: PatchResource[] = data.map((resource) => ({
    id: resource.id,
    name: resource.name,
    section: resource.section,
    uniqueId: resource.patch.unique_id,
    type: resource.type,
    language: resource.language,
    note: resource.note,
    platform: resource.platform,
    links: resource.links.map((link) => {
      const obtainedExpires = expiresByResourceId.get(resource.id)

      return {
        id: link.id,
        storage: link.storage,
        size: link.size,
        hash: link.hash,
        sortOrder: link.sort_order,
        download: link.download,
        revealed: revealedLinkIds.has(link.id),
        ...(obtainedExpires
          ? {
              obtained: true,
              obtainedExpiresAt: obtainedExpires.toISOString()
            }
          : {})
      }
    }),
    download: resource.download,
    likeCount: resource._count.like_by,
    isLike: resource.like_by.length > 0,
    status: resource.status,
    userId: resource.user_id,
    patchId: resource.patch_id,
    created: String(resource.created),
    user: {
      id: resource.user.id,
      name: resource.user.name,
      avatar: resource.user.avatar,
      patchCount: resource.user._count.patch_resource,
      role: resource.user.role
    }
  }))

  // 按平台优先级排序，相同平台则按语言优先级排序
  resources.sort(compareResources)

  return resources
}
