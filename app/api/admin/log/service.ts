import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminLogPaginationSchema } from '~/validations/admin'
import type { AdminLog } from '~/types/api/admin'

export const getLog = async (
  input: z.infer<typeof adminLogPaginationSchema>
) => {
  const { page, limit } = input
  const offset = (page - 1) * limit
  const search = input.search?.trim()
  const where = {
    ...(input.type ? { type: input.type } : {}),
    ...(input.userId ? { user_id: input.userId } : {}),
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
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    }),
    prisma.admin_log.count({ where })
  ])

  const logs: AdminLog[] = data.map((log) => ({
    id: log.id,
    type: log.type,
    user: log.user,
    content: log.content,
    created: log.created
  }))

  return { logs, total }
}
