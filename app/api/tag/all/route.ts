import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { prisma } from '~/prisma/index'
import { getTagSchema } from '~/validations/tag'
import { getOrSet } from '~/lib/redis'
import { createHash } from 'crypto'
import type { Tag } from '~/types/api/tag'

export const getTag = async (input: z.infer<typeof getTagSchema>) => {
  const cacheKey = `tag_list:${createHash('md5')
    .update(JSON.stringify(input))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const { page, limit } = input
      const offset = (page - 1) * limit

      const [data, total] = await Promise.all([
        prisma.patch_tag.findMany({
          take: limit,
          skip: offset,
          orderBy: { count: 'desc' }
        }),
        prisma.patch_tag.count()
      ])

      const tags: Tag[] = data.map((tag) => ({
        id: tag.id,
        name: tag.name,
        count: tag.count,
        alias: tag.alias
      }))

      return { tags, total }
    },
    10
  )
}

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await getTag(input)
  return NextResponse.json(response)
}
