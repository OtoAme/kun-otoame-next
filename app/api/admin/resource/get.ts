import {
  getLinkDisputeSources,
  linkHealthSelect,
  projectLinkHealth,
  type LinkHealthViewer
} from '~/app/api/patch/resource/linkHealthProjection'
import type { PatchResourceHealthEditData } from '~/types/api/patch'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminResourcePaginationSchema } from '~/validations/admin'
import type { AdminResource } from '~/types/api/admin'
import type { Prisma } from '@prisma/client'

type AdminResourceQuery = z.infer<typeof adminResourcePaginationSchema>

const ADMIN_RESOURCE_ORDER: Record<
  NonNullable<AdminResourceQuery['sort']>,
  Prisma.patch_resourceOrderByWithRelationInput[]
> = {
  created_desc: [{ created: 'desc' }, { id: 'desc' }],
  created_asc: [{ created: 'asc' }, { id: 'asc' }],
  download_desc: [{ download: 'desc' }, { id: 'desc' }],
  download_asc: [{ download: 'asc' }, { id: 'asc' }]
}

const contains = (value: string) => ({
  contains: value,
  mode: 'insensitive' as const
})

/** Day boundaries for a Shanghai calendar date (YYYY-MM-DD). */
const shanghaiDayStart = (date: string) => new Date(`${date}T00:00:00+08:00`)
const shanghaiDayEnd = (date: string) =>
  new Date(shanghaiDayStart(date).getTime() + 24 * 60 * 60 * 1000)

const searchWhere = (
  search: string,
  field: AdminResourceQuery['searchField']
): Prisma.patch_resourceWhereInput => {
  const linkMatch: Prisma.patch_resourceWhereInput = {
    OR: [
      { links: { some: { content: contains(search) } } },
      { links: { some: { hash: contains(search) } } }
    ]
  }
  const textMatch: Prisma.patch_resourceWhereInput[] = [
    { name: contains(search) },
    { note: contains(search) }
  ]
  const gameMatch: Prisma.patch_resourceWhereInput = {
    patch: { name: contains(search) }
  }
  const id = /^\d{1,10}$/.test(search) ? Number(search) : null
  const idMatch =
    id !== null && id <= 2147483647 ? [{ id } as const] : ([] as const)
  switch (field) {
    // Without a field the search keeps its original meaning.
    case undefined:
    case 'link':
      return linkMatch
    case 'text':
      return { OR: textMatch }
    case 'game':
      return gameMatch
    case 'id':
      return idMatch.length ? idMatch[0] : { id: -1 }
    case 'all':
      // Links and access codes are restricted, so the default never searches them.
      return { OR: [...textMatch, gameMatch, ...idMatch] }
  }
}

const HEALTH_WHERE: Record<
  NonNullable<AdminResourceQuery['health']>,
  Prisma.patch_resourceWhereInput
> = {
  broken: { links: { some: { health: 'broken' } } },
  attention: { links: { some: { health: { in: ['suspect', 'disputed'] } } } },
  // `every` alone also matches resources with no links at all.
  healthy: { links: { some: {}, every: { health: 'ok' } } }
}

const RATING_WHERE: Record<
  NonNullable<AdminResourceQuery['rating']>,
  Prisma.patchWhereInput
> = {
  all: {},
  sfw: { content_limit: 'sfw' },
  nsfw: { content_limit: 'nsfw' }
}

export const buildAdminResourceWhere = (
  input: AdminResourceQuery,
  nsfwEnable: Record<string, string | undefined>
): Prisma.patch_resourceWhereInput => {
  const search = input.search?.trim()
  const and: Prisma.patch_resourceWhereInput[] = []
  if (input.resourceId !== undefined) and.push({ id: input.resourceId })
  if (search) and.push(searchWhere(search, input.searchField))
  if (input.userId) and.push({ user_id: input.userId })
  if (input.section) and.push({ section: input.section })
  if (input.status) and.push({ status: { in: input.status } })
  if (input.publisher === 'official') and.push({ user: { role: { gte: 3 } } })
  if (input.publisher === 'user') and.push({ user: { role: { lt: 3 } } })
  if (input.type) and.push({ type: { hasSome: input.type } })
  if (input.language) and.push({ language: { hasSome: input.language } })
  if (input.platform) and.push({ platform: { hasSome: input.platform } })
  if (input.health) and.push(HEALTH_WHERE[input.health])
  if (input.from) and.push({ created: { gte: shanghaiDayStart(input.from) } })
  if (input.to) and.push({ created: { lt: shanghaiDayEnd(input.to) } })
  // An explicit rating replaces the viewer's display setting.
  and.push({
    patch: input.rating ? RATING_WHERE[input.rating] : nsfwEnable
  })
  return { AND: and }
}

export const getPatchResource = async (
  input: z.infer<typeof adminResourcePaginationSchema>,
  nsfwEnable: Record<string, string | undefined>,
  viewer?: LinkHealthViewer
) => {
  const { page, limit } = input
  const offset = (page - 1) * limit
  const now = new Date()
  const where = buildAdminResourceWhere(input, nsfwEnable)
  const orderBy = ADMIN_RESOURCE_ORDER[input.sort ?? 'created_desc']

  const [data, total] = await Promise.all([
    prisma.patch_resource.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy,
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
            role: true
          }
        },
        links: {
          select: linkHealthSelect(now),
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
        download: link.download
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
        patchCount: 0
      }
    })
  )

  return { resources, total }
}
