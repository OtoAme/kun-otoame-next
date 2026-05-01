import { prisma } from '~/prisma/index'
import { purgeUserAvatarCache } from '~/app/api/utils/purgeCache'
import { uploadUserAvatar } from '../_upload'

export const updateUserAvatar = async (uid: number, avatar: ArrayBuffer) => {
  const user = await prisma.user.findUnique({
    where: { id: uid }
  })
  if (!user) {
    return '用户未找到'
  }
  if (user.daily_image_count >= 50) {
    return '您今日上传的图片已达到 50 张限额'
  }

  const res = await uploadUserAvatar(avatar, uid)
  if (typeof res === 'string') {
    return res
  }

  const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/user/avatar/user_${uid}/avatar-mini.avif`

  await prisma.user.update({
    where: { id: uid },
    data: { avatar: imageLink }
  })

  await purgeUserAvatarCache(uid)

  return { avatar: imageLink }
}
