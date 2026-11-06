import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { compareResources } from '~/constants/resource'
import {
  getResourceAccessViewerKey,
  getResourceAccessViewerWhere
} from './download/access/actor'
import type { ResourceAccessViewer } from './download/access/actor'
import type { PatchResourceHealth } from '~/types/api/patch'
import { recognizeResourceDiskKind } from '~/utils/resourceDiskKind'
import { getPublicResourceCaseBadges } from '~/app/api/case/service'
import {
  getLinkDisputeSources,
  linkHealthSelect,
  projectLinkHealth
} from './linkHealthProjection'

const patchIdSchema = z.object({
  patchId: z.coerce.number().min(1).max(9999999)
})

const asDate = (value: Date | string | null | undefined) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const laterDate = (left: Date | null, right: Date | null) => {
  if (left && right) return left > right ? left : right
  return left ?? right
}

const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null)

const linkChangeTime = (
  storage: string,
  attachedAt: Date | null,
  contentChangedAt: Date | null
) => (storage === 'touchgal' ? laterDate(attachedAt, contentChangedAt) : null)

const normalizeResourceAccessViewer = (
  viewer: number | (ResourceAccessViewer & { role?: number })
): ResourceAccessViewer & { role?: number } =>
  typeof viewer === 'number' ? { uid: viewer } : viewer

export const getPatchResource = async (
  input: z.infer<typeof patchIdSchema>,
  viewer: number | (ResourceAccessViewer & { role?: number }),
  visibilityWhere?: Prisma.patchWhereInput
) => {
  const { patchId } = input
  const accessViewer = normalizeResourceAccessViewer(viewer)
  const now = new Date()

  const data = await prisma.patch_resource.findMany({
    where: {
      patch_id: patchId,
      status: 0,
      ...(visibilityWhere
        ? {
            patch: {
              id: patchId,
              status: 0,
              ...visibilityWhere
            }
          }
        : {})
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
          ...linkHealthSelect(now),
          attached_at: true
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

  const resourceIds = data.map((resource) => resource.id)
  const linkIds = data.flatMap((resource) =>
    resource.links.map((link) => link.id)
  )
  const versionsByLinkId = new Map(
    data.flatMap((resource) =>
      resource.links.map((link) => [link.id, link.version] as const)
    )
  )
  const disputeSources = await getLinkDisputeSources(
    data.flatMap((resource) =>
      resource.links.map((link) => ({
        ...link,
        resourceId: resource.id,
        patchId: resource.patch_id
      }))
    )
  )
  const caseSummaries =
    'ops_case' in (prisma as unknown as Record<string, unknown>)
      ? await getPublicResourceCaseBadges(resourceIds, { db: prisma })
      : new Map()
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
            select: {
              resource_id: true,
              link_id: true,
              link_version: true,
              expires: true
            }
          })
        ])
      : [[], []]

  const expiresByResourceId = new Map<number, Date>()
  for (const grant of activeGrants) {
    if (!(grant.expires instanceof Date) || grant.expires <= now) continue
    expiresByResourceId.set(grant.resource_id, grant.expires)
  }
  const resourceIdByLinkId = new Map<number, number>()
  for (const resource of data) {
    for (const link of resource.links) {
      resourceIdByLinkId.set(link.id, resource.id)
    }
  }
  const revealedExpiresByLinkId = new Map<number, Date>()
  for (const access of revealedAccess) {
    const resourceId =
      access.link_id === null
        ? undefined
        : resourceIdByLinkId.get(access.link_id)
    if (
      access.link_id === null ||
      resourceId === undefined ||
      !expiresByResourceId.has(resourceId) ||
      (typeof access.resource_id === 'number' &&
        access.resource_id !== resourceId) ||
      access.link_version === null ||
      !(access.expires instanceof Date) ||
      access.expires <= now ||
      access.link_version !== versionsByLinkId.get(access.link_id)
    ) {
      continue
    }
    const current = revealedExpiresByLinkId.get(access.link_id)
    if (!current || access.expires > current) {
      revealedExpiresByLinkId.set(access.link_id, access.expires)
    }
  }

  const resources: PatchResourceHealth[] = data.map((resource) => ({
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
      const revealedExpires = revealedExpiresByLinkId.get(link.id)
      const changeTime = linkChangeTime(
        link.storage,
        asDate(link.attached_at),
        asDate(link.content_changed_at)
      )

      return {
        ...projectLinkHealth(
          link,
          resource.user_id,
          { uid: accessViewer.uid, role: accessViewer.role ?? 0 },
          disputeSources.get(link.id) ?? null,
          now
        ),
        id: link.id,
        storage: link.storage,
        size: link.size,
        hash: link.hash,
        diskKind: recognizeResourceDiskKind(link.content, link.storage),
        sortOrder: link.sort_order,
        download: link.download,
        backedUpAt: isoOrNull(changeTime),
        revealed: revealedExpires !== undefined,
        ...(revealedExpires
          ? { revealedExpiresAt: revealedExpires.toISOString() }
          : {}),
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
    caseSummaries: caseSummaries.get(resource.id) ?? [],
    created: String(resource.created),
    publisherLeftAt: isoOrNull(asDate(resource.publisher_left_at)),
    hasStaffBackup: resource.links.some((link) => link.storage === 'touchgal'),
    backedUpAt: isoOrNull(
      resource.links.reduce<Date | null>((max, link) => {
        const changeTime = linkChangeTime(
          link.storage,
          asDate(link.attached_at),
          asDate(link.content_changed_at)
        )
        if (!changeTime) return max
        return max && max > changeTime ? max : changeTime
      }, null)
    ),
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
