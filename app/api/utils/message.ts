import { prisma } from '~/prisma/index'
import type { PrismaClient } from '@prisma/client'
import type { CreateMessageType } from '~/types/api/message'

type MessageClient = Pick<PrismaClient, 'user_message'>

export const createMessage = async (
  data: CreateMessageType,
  db: MessageClient = prisma
) => {
  const message = await db.user_message.create({
    data
  })
  return message
}

export const createDedupMessage = async (
  data: CreateMessageType,
  db: MessageClient = prisma
) => {
  const duplicatedMessage = await db.user_message.findFirst({
    where: {
      ...data
    }
  })
  if (duplicatedMessage) {
    return
  }

  const message = createMessage(data, db)

  return message
}
