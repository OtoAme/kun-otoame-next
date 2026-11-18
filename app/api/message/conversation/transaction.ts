import type { Prisma, user_conversation } from '@prisma/client'

export const lockConversation = async (
  transaction: Prisma.TransactionClient,
  conversationId: number,
  userId: number
) => {
  const conversations = await transaction.$queryRaw<user_conversation[]>`
    SELECT * FROM user_conversation
    WHERE id = ${conversationId}
      AND (user_a_id = ${userId} OR user_b_id = ${userId})
    FOR UPDATE
  `
  return conversations[0] ?? null
}
