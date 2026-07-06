import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { compareResources } from '~/constants/resource'
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

  const linkIds = data.flatMap((resource) =>
    resource.links.map((link) => link.id)
  )
  const activeAccessWhere =
    accessViewer.uid > 0
      ? {
          user_id: accessViewer.uid,
          link_id: { in: linkIds },
          expires: { gt: new Date() }
        }
      : accessViewer.visitorToken
        ? {
            visitor_token: accessViewer.visitorToken,
            link_id: { in: linkIds },
            expires: { gt: new Date() }
          }
        : null

  const activeAccess = activeAccessWhere
    ? await prisma.patch_resource_access.findMany({
        where: activeAccessWhere,
        select: {
          link_id: true,
          expires: true
        },
        orderBy: { expires: 'desc' }
      })
    : []

  const activeAccessByLinkId = new Map<number, Date>()
  activeAccess.forEach((access) => {
    if (!activeAccessByLinkId.has(access.link_id)) {
      activeAccessByLinkId.set(access.link_id, access.expires)
    }
  })

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
      const obtainedExpires = activeAccessByLinkId.get(link.id)

      return {
        id: link.id,
        storage: link.storage,
        size: link.size,
        hash: link.hash,
        sortOrder: link.sort_order,
        download: link.download,
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
