import { prisma } from '~/prisma/index'
import { uploadIntroductionImage } from './_upload'

export const uploadImage = async (uid: number, image: ArrayBuffer) => {
  const user = await prisma.user.findUnique({
    where: { id: uid }
  })
  if (!user) {
    return '用户未找到'
  }
  if (user.daily_image_count >= 50) {
    return '您今日上传的图片已达到 50 张限额'
  }

  const newFileName = `${uid}-${Date.now()}`

  const res = await uploadIntroductionImage(newFileName, image, uid)
  if (typeof res === 'string') {
    return res
  }

  await prisma.user.update({
    where: { id: uid },
    data: { daily_image_count: { increment: 1 } }
  })

  const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/user/image/${uid}/${newFileName}.avif`
  return { imageLink }
}
