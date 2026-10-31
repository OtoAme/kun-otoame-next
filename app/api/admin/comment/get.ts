import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { adminCommentPaginationSchema } from '~/validations/admin'
import { markdownToText } from '~/utils/markdownToText'
import type { AdminComment } from '~/types/api/admin'

// List rows carry a plain-text excerpt; the full text loads on edit.
const LIST_TEXT_LENGTH = 233

export const getComment = async (
  input: z.infer<typeof adminCommentPaginationSchema>
) => {
  const { page, limit, search, searchType, userId } = input
  const offset = (page - 1) * limit
  const normalizedSearch = search?.trim()

  const where = (() => {
    if (searchType === 'user' && userId) {
      return { user_id: userId }
    }

    if (!normalizedSearch) {
      return {}
    }

    return {
      content: {
        contains: normalizedSearch,
        mode: 'insensitive' as const
      }
    }
  })()

  const [data, total] = await Promise.all([
    prisma.patch_comment.findMany({
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
            avatar: true
          }
        },
        _count: {
          select: {
            like_by: true
          }
        }
      }
    }),
    prisma.patch_comment.count({ where })
  ])

  const comments: AdminComment[] = data.map((comment) => {
    const text = markdownToText(comment.content)
    return {
      id: comment.id,
      uniqueId: comment.patch.unique_id,
      user: comment.user,
      content: text.slice(0, LIST_TEXT_LENGTH),
      truncated: text.length > LIST_TEXT_LENGTH,
      patchName: comment.patch.name,
      patchId: comment.patch_id,
      like: comment._count.like_by,
      created: comment.created
    }
  })

  return { comments, total }
}
