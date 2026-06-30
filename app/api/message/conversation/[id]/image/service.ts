import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { prisma } from '~/prisma/index'
import { uploadImageToS3 } from '~/lib/s3'
import type { PrivateMessageImage } from '~/types/api/conversation'

const MAX_PRIVATE_MESSAGE_IMAGE_SIZE = 8 * 1024 * 1024
const MAX_PRIVATE_MESSAGE_AVIF_SIZE_MB = 1.5
const ALLOWED_PRIVATE_MESSAGE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
])

const processConversationImage = async (buffer: Buffer) =>
  sharp(buffer)
    .resize(1920, 1080, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .avif({ quality: 60, effort: 3 })
    .toBuffer()

const getAvifName = (fileName: string) => {
  const trimmed = fileName.trim().slice(0, 255)
  const base = trimmed.replace(/\.[^.]+$/, '') || 'image'
  return `${base.slice(0, 250)}.avif`
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
  const processed = await processConversationImage(buffer)
  if (!checkBufferSize(processed, MAX_PRIVATE_MESSAGE_AVIF_SIZE_MB)) {
    return '图片压缩后仍超过 1.5 MB'
  }

  const metadata = await sharp(processed).metadata()
  const key = `conversation/${conversationId}/${uid}-${Date.now()}-${randomUUID()}.avif`

  await uploadImageToS3(key, processed, 'image/avif')

  return {
    url: `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${key}`,
    width: metadata.width ?? 1,
    height: metadata.height ?? 1,
    size: processed.length,
    mime: 'image/avif',
    name: getAvifName(file.name)
  }
}
