import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { adminLogPaginationSchema } from '~/validations/admin'
import {
  EMAIL_REGEX_SQL,
  LOG_EMAIL_SEARCH_DENIED,
  LOG_FULL_CONTENT_MIN_ROLE,
  maskEmails,
  searchesIntoEmail
} from '~/utils/maskEmail'
import type { AdminLog } from '~/types/api/admin'

const logInclude = {
  user: { select: { id: true, name: true, avatar: true } }
} as const

/**
 * Management log page. Some entries embed account data (user edits and
 * deletions record the email), so below super administrator the content is
 * masked. A masked viewer's search runs against the masked text, so a term
 * that only occurs inside an address finds nothing and the count cannot
 * confirm it; a term containing `@` is refused outright.
 */
export const getLog = async (
  input: z.infer<typeof adminLogPaginationSchema>,
  viewerRole: number
) => {
  const fullContent = viewerRole >= LOG_FULL_CONTENT_MIN_ROLE
  const { page, limit } = input
  const offset = (page - 1) * limit
  const search = input.search?.trim()
  if (search && !fullContent && searchesIntoEmail(search)) {
    return LOG_EMAIL_SEARCH_DENIED
  }

  const filters: Prisma.admin_logWhereInput = {
    ...(input.type ? { type: input.type } : {}),
    ...(input.userId ? { user_id: input.userId } : {})
  }

  // Search over the same text the viewer will be shown.
  const searchIds =
    search && !fullContent
      ? await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
          SELECT id FROM admin_log
          WHERE regexp_replace(content, ${EMAIL_REGEX_SQL}, '', 'g') ILIKE ${`%${escapeLike(search)}%`}
          ${input.type ? Prisma.sql`AND type = ${input.type}` : Prisma.empty}
          ${input.userId ? Prisma.sql`AND user_id = ${input.userId}` : Prisma.empty}
        `)
      : null

  const where: Prisma.admin_logWhereInput = searchIds
    ? { ...filters, id: { in: searchIds.map((row) => row.id) } }
    : {
        ...filters,
        ...(search
          ? { content: { contains: search, mode: 'insensitive' as const } }
          : {})
      }

  const [data, total] = await Promise.all([
    prisma.admin_log.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      include: logInclude
    }),
    prisma.admin_log.count({ where })
  ])

  const logs: AdminLog[] = data.map((log) => ({
    id: log.id,
    type: log.type,
    user: log.user,
    content: fullContent ? log.content : maskEmails(log.content),
    created: log.created
  }))

  return { logs, total }
}

/** ILIKE treats `%`, `_` and `\` specially; match them literally. */
const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`)
