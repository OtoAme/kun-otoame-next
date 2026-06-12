import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { patchCommentUpdateSchema } from '~/validations/patch'
import { invalidatePatchContentCache } from '~/app/api/patch/cache'

export const updateComment = async (
  input: z.infer<typeof patchCommentUpdateSchema>,
  uid: number
) => {
  const comment = await prisma.patch_comment.findUnique({
    where: { id: input.commentId },
    include: {
      patch: {
        select: {
          unique_id: true
        }
      }
    }
  })
  if (!comment) {
    return '未找到对应的评论'
  }
  const admin = await prisma.user.findUnique({ where: { id: uid } })
  if (!admin) {
    return '未找到该管理员'
  }

  const { commentId, content } = input

  const response = await prisma.$transaction(async (prisma) => {
    await prisma.patch_comment.update({
      where: { id: commentId },
      data: {
        content,
        edit: Date.now().toString()
      },
      include: {
        user: true,
        like_by: {
          include: {
            user: true
          }
        }
      }
    })

    await prisma.admin_log.create({
      data: {
        type: 'update',
        user_id: uid,
        content: `管理员 ${admin.name} 更新了一条评论的内容\n原评论: ${JSON.stringify(comment)}`
      }
    })

    return {}
  })

  await invalidatePatchContentCache(comment.patch.unique_id).catch((error) => {
    console.error('Failed to invalidate admin comment cache:', error)
  })

  return response
}
