import {
  getLinkDisputeSources,
  linkHealthSelect,
  projectLinkHealth,
  type LinkHealthViewer
} from '~/app/api/patch/resource/linkHealthProjection'
import type { PatchResourceHealthEditData } from '~/types/api/patch'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminPaginationSchema } from '~/validations/admin'
import type { AdminResource } from '~/types/api/admin'

const asDate = (value: Date | string | null | undefined) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const laterDate = (left: Date | null, right: Date | null) => {
  if (left && right) return left > right ? left : right
  return left ?? right
}

/** Touchgal backup time is the later of attach and content change. Other storages stay null. */
const touchgalBackedUpAt = (link: {
  storage: string
  attached_at: Date | null
  content_changed_at: Date | null
}) => {
  if (link.storage !== 'touchgal') return null
  const time = laterDate(
    asDate(link.attached_at),
    asDate(link.content_changed_at)
  )
  return time ? time.toISOString() : null
}

export const getPatchResourceApply = async (
  input: z.infer<typeof adminPaginationSchema>,
  nsfwEnable: Record<string, string | undefined>,
  viewer?: LinkHealthViewer
) => {
  const { page, limit, search } = input
  const offset = (page - 1) * limit
  const now = new Date()

  const whereBase = {
    patch: nsfwEnable,
    status: 2
  } as const

  const where = search
    ? {
        ...whereBase,
        links: {
          some: {
            content: {
              contains: search,
              mode: 'insensitive' as const
            }
          }
        }
      }
    : whereBase

  const [data, total] = await Promise.all([
    prisma.patch_resource.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { created: 'desc' },
      include: {
        patch: {
          select: {
            name: true,
            unique_id: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
            role: true,
            _count: {
              select: {
                patch_resource: true
              }
            }
          }
        },
        links: {
          select: {
            ...linkHealthSelect(now),
            attached_at: true
          },
          orderBy: { sort_order: 'asc' }
        }
      }
    }),
    prisma.patch_resource.count({ where })
  ])

  const disputeSources = await getLinkDisputeSources(
    data.flatMap((resource) =>
      resource.links.map((link) => ({
        ...link,
        resourceId: resource.id,
        patchId: resource.patch_id
      }))
    )
  )

  const resources: (AdminResource & PatchResourceHealthEditData)[] = data.map(
    (resource) => ({
      id: resource.id,
      name: resource.name,
      section: resource.section,
      uniqueId: resource.patch.unique_id,
      patchName: resource.patch.name,
      type: resource.type,
      language: resource.language,
      note: resource.note,
      platform: resource.platform,
      baseLinks: resource.links.map((link) => ({
        id: link.id,
        version: link.version
      })),
      links: resource.links.map((link) => ({
        ...projectLinkHealth(
          link,
          resource.user_id,
          viewer,
          disputeSources.get(link.id) ?? null,
          now
        ),
        id: link.id,
        storage: link.storage,
        size: link.size,
        code: link.code,
        password: link.password,
        hash: link.hash,
        content: link.content,
        sortOrder: link.sort_order,
        download: link.download,
        backedUpAt: touchgalBackedUpAt(link)
      })),
      download: resource.download,
      likeCount: 0,
      isLike: false,
      status: resource.status,
      userId: resource.user_id,
      patchId: resource.patch_id,
      created: String(resource.created),
      user: {
        id: resource.user.id,
        name: resource.user.name,
        avatar: resource.user.avatar,
        role: resource.user.role,
        patchCount: resource.user._count.patch_resource
      }
    })
  )

  return { resources, total }
}
