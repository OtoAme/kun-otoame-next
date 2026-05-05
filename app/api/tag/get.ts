import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { TAG_LIST_CACHE_DURATION } from '~/config/cache'
import { getOrSet } from '~/lib/redis'
import { getTagByIdSchema } from '~/validations/tag'
import type { TagDetail } from '~/types/api/tag'

export const getTagById = async (input: z.infer<typeof getTagByIdSchema>) => {
  const { tagId } = input

  const tag = await getOrSet<TagDetail | null>(
    `tag_detail:${tagId}`,
    async () =>
      prisma.patch_tag.findUnique({
        where: { id: tagId },
        select: {
          id: true,
          name: true,
          count: true,
          alias: true,
          introduction: true,
          created: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          }
        }
      }),
    TAG_LIST_CACHE_DURATION
  )
  if (!tag) {
    return '未找到标签'
  }

  return tag
}
