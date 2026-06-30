import crypto from 'crypto'
import sharp from 'sharp'
import { prisma } from '~/prisma/index'
import { uploadImageToS3 } from '~/lib/s3'
import type { PrivateMessageImage } from '~/types/api/conversation'

const MAX_PRIVATE_MESSAGE_IMAGE_SIZE = 8 * 1024 * 1024
const ALLOWED_PRIVATE_MESSAGE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
])

const getImageExtension = (mime: string) => {
  if (mime === 'image/jpeg') {
    return 'jpg'
  }
  return mime.split('/')[1] ?? 'bin'
}

export const uploadConversationImage = async (
  conversationId: number,
  file: File,
  uid: number
): Promise<PrivateMessageImage | string> => {
  const conversation = await prisma.user_conversation.findUnique({
    where: { id: conversationId }
  })

  if (
    !conversation ||
    (conversation.user_a_id !== uid && conversation.user_b_id !== uid)
  ) {
    return '会话不存在或无权访问'
  }

  if (!ALLOWED_PRIVATE_MESSAGE_IMAGE_TYPES.has(file.type)) {
    return '仅支持 JPG、PNG、WebP、AVIF 图片'
  }

  if (file.size > MAX_PRIVATE_MESSAGE_IMAGE_SIZE) {
    return '图片大小不能超过 8 MB'
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const metadata = await sharp(buffer, { animated: true }).metadata()
  const extension = getImageExtension(file.type)
  const key = `conversation/${conversationId}/${uid}-${Date.now()}-${crypto.randomUUID()}.${extension}`

  await uploadImageToS3(key, buffer, file.type)

  return {
    url: `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${key}`,
    width: metadata.width ?? 1,
    height: metadata.height ?? 1,
    size: file.size,
    mime: file.type,
    name: file.name.slice(0, 255)
  }
}
