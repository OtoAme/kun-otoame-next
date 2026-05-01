import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { togglePatchFavoriteSchema } from '~/validations/patch'
import { createDedupMessage } from '~/app/api/utils/message'

export const togglePatchFavorite = async (
  input: z.infer<typeof togglePatchFavoriteSchema>,
  uid: number
) => {
  const patch = await prisma.patch.findUnique({
    where: { id: input.patchId }
  })
  if (!patch) {
    return '未找到 OtomeGame'
  }

  const folder = await prisma.user_patch_favorite_folder.findUnique({
    where: { id: input.folderId }
  })
  if (!folder) {
    return '未找到收藏文件夹'
  }
  if (folder.user_id !== uid) {
    return '这不是您的收藏夹'
  }

  const existing = await prisma.user_patch_favorite_folder_relation.findUnique({
    where: {
      folder_id_patch_id: {
        folder_id: input.folderId,
        patch_id: input.patchId
      }
    }
  })

  return await prisma.$transaction(async (prisma) => {
    if (patch.user_id !== uid) {
      await createDedupMessage({
        type: 'favorite',
        content: patch.name,
        sender_id: uid,
        recipient_id: patch.user_id,
        link: `/${patch.unique_id}`
      })
    }

    if (existing) {
      await prisma.user_patch_favorite_folder_relation.delete({
        where: {
          folder_id_patch_id: {
            folder_id: input.folderId,
            patch_id: input.patchId
          }
        }
      })
      return { added: false }
    } else {
      await prisma.user_patch_favorite_folder_relation.create({
        data: {
          folder_id: input.folderId,
          patch_id: input.patchId
        }
      })
      return { added: true }
    }
  })
}
