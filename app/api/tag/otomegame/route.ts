import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { prisma } from '~/prisma/index'
import { getPatchByTagSchema } from '~/validations/tag'
import { GalgameCardSelectField } from '~/constants/api/select'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getKv, setKv } from '~/lib/redis'
import { createHash } from 'crypto'

export const getPatchByTag = async (
  input: z.infer<typeof getPatchByTagSchema>,
  nsfwEnable: Record<string, string | undefined>
) => {
  const cacheKey = `tag_galgame_list:${createHash('md5')
    .update(JSON.stringify({ input, nsfwEnable }))
    .digest('hex')}`

  const cachedData = await getKv(cacheKey)
  if (cachedData) {
    return JSON.parse(cachedData)
  }

  const { tagId, page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.patch_tag_relation.findMany({
      where: { tag_id: tagId, patch: nsfwEnable },
      select: {
        patch: {
          select: GalgameCardSelectField
        }
      },
      orderBy: { patch: { [input.sortField]: 'desc' } },
      take: limit,
      skip: offset
    }),
    prisma.patch_tag_relation.count({
      where: { tag_id: tagId, patch: nsfwEnable }
    })
  ])

  const patches = data.map((p) => p.patch)
  const galgames: GalgameCard[] = patches.map((gal) => ({
    ...gal,
    tags: gal.tag.map((t) => t.tag.name).slice(0, 3),
    uniqueId: gal.unique_id,
    averageRating: gal.rating_stat?.avg_overall
      ? Math.round(gal.rating_stat.avg_overall * 10) / 10
      : 0
  }))

  const result = { galgames, total }
  await setKv(cacheKey, JSON.stringify(result), 10)

  return result
}

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getPatchByTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const nsfwEnable = getNSFWHeader(req)

  const response = await getPatchByTag(input, nsfwEnable)
  return NextResponse.json(response)
}
