import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { checkBufferSize } from '~/app/api/utils/checkBufferSize'
import { prisma } from '~/prisma/index'
import { deleteFileFromS3, uploadImageToS3 } from '~/lib/s3'
import type { PrivateMessageImage } from '~/types/api/conversation'
import { registerConversationImageUpload } from '../../imageUploadMetadata'
import {
  checkConversationActionRateLimit,
  CONVERSATION_IMAGE_UPLOAD_OVERAGE_MOEMOEPOINT_COST,
  consumeConversationImageUploadQuota,
  rollbackConversationImageUploadQuota,
  type ConversationImageUploadQuotaReservation
} from '../../rateLimit'
import {
  createConversationRateLimitResponse,
  type ConversationRateLimitResponse
} from '../../response'

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

const verifyRecipientAllowsPrivateImageUpload = async (
  conversation: { user_a_id: number; user_b_id: number },
  senderId: number
) => {
  const recipientId =
    conversation.user_a_id === senderId
      ? conversation.user_b_id
      : conversation.user_a_id

  if (recipientId === senderId) {
    return null
  }

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, allow_private_message: true }
  })

  if (!recipient) {
    return '目标用户不存在'
  }

  return recipient.allow_private_message ? null : '对方已关闭接收私信'
}

const chargeImageUploadOverage = async (uid: number, cost: number) => {
  if (cost <= 0) {
    return true
  }

  const result = await prisma.user.updateMany({
    where: { id: uid, moemoepoint: { gte: cost } },
    data: { moemoepoint: { decrement: cost } }
  })

  return result.count > 0
}

const refundImageUploadOverage = async (uid: number, cost: number) => {
  if (cost <= 0) {
    return
  }

  try {
    await prisma.user.update({
      where: { id: uid },
      data: { moemoepoint: { increment: cost } }
    })
  } catch (error) {
    console.error('Failed to refund conversation image upload overage', {
      uid,
      cost,
      error
    })
  }
}

const rollbackFailedUploadReservation = async (
  uid: number,
  reservation: ConversationImageUploadQuotaReservation,
  chargedCost: number
) => {
  await Promise.all([
    rollbackConversationImageUploadQuota(uid, reservation),
    refundImageUploadOverage(uid, chargedCost)
  ])
}

export const uploadConversationImage = async (
  conversationId: number,
  file: File,
  uid: number
): Promise<PrivateMessageImage | string | ConversationRateLimitResponse> => {
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

  const recipientError = await verifyRecipientAllowsPrivateImageUpload(
    conversation,
    uid
  )
  if (recipientError) {
    return recipientError
  }

  const rateLimit = await checkConversationActionRateLimit('image-upload', uid)
  if (!rateLimit.allowed) {
    return createConversationRateLimitResponse(
      rateLimit.message,
      rateLimit.retryAfterMs
    )
  }

  const quotaReservation = await consumeConversationImageUploadQuota(uid)
  if (quotaReservation.unavailable) {
    return '图片上传系统繁忙，请稍后重试'
  }

  const quotaCost = quotaReservation.cost
  let chargedCost = 0
  if (quotaCost > 0) {
    const charged = await chargeImageUploadOverage(uid, quotaCost)
    if (!charged) {
      await rollbackConversationImageUploadQuota(uid, quotaReservation)
      return `萌萌点不足，额外上传一张私聊图片需要 ${CONVERSATION_IMAGE_UPLOAD_OVERAGE_MOEMOEPOINT_COST} 萌萌点`
    }
    chargedCost = quotaCost
  }

  let processed: Buffer
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    processed = await processConversationImage(buffer)
  } catch (error) {
    await rollbackFailedUploadReservation(uid, quotaReservation, chargedCost)
    console.error('Failed to process conversation image upload', {
      conversationId,
      uid,
      error
    })
    return '图片处理失败，请重新选择有效图片'
  }

  if (!checkBufferSize(processed, MAX_PRIVATE_MESSAGE_AVIF_SIZE_MB)) {
    await rollbackFailedUploadReservation(uid, quotaReservation, chargedCost)
    return '图片压缩后仍超过 1.5 MB'
  }

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(processed).metadata()
  } catch (error) {
    await rollbackFailedUploadReservation(uid, quotaReservation, chargedCost)
    console.error('Failed to read processed conversation image metadata', {
      conversationId,
      uid,
      error
    })
    return '图片处理失败，请重新选择有效图片'
  }
  const key = `conversation/${conversationId}/${uid}-${Date.now()}-${randomUUID()}.avif`

  try {
    await uploadImageToS3(key, processed, 'image/avif')
  } catch (error) {
    await rollbackFailedUploadReservation(uid, quotaReservation, chargedCost)
    console.error('Failed to upload conversation image', {
      conversationId,
      uid,
      key,
      error
    })
    return '图片上传到对象存储失败，请稍后重试'
  }

  const image = {
    url: `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${key}`,
    width: metadata.width ?? 1,
    height: metadata.height ?? 1,
    size: processed.length,
    mime: 'image/avif',
    name: getAvifName(file.name)
  }

  try {
    await registerConversationImageUpload(conversationId, uid, image)
  } catch (error) {
    try {
      await deleteFileFromS3(key)
    } catch (deleteError) {
      console.error('Failed to delete unregistered conversation image', {
        key,
        error: deleteError
      })
    }
    await rollbackFailedUploadReservation(uid, quotaReservation, chargedCost)
    console.error('Failed to register conversation image upload', {
      conversationId,
      uid,
      error
    })
    return '图片上传记录保存失败，请稍后重试'
  }

  return image
}
