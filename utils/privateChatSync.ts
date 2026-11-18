import type { PrivateMessage } from '~/types/api/conversation'

export const getChatSyncInterval = (quietSince: number, now = Date.now()) => {
  const quietFor = now - quietSince
  return quietFor >= 180_000 ? 15_000 : quietFor >= 60_000 ? 5_000 : 2_000
}

export const deletedChatMessage = (
  message: PrivateMessage
): PrivateMessage => ({
  ...message,
  type: 0,
  content: '',
  isDeleted: true,
  image: null,
  images: [],
  stickerId: null,
  sticker: null,
  replyTo: null
})

export const mergeChatMessages = (
  current: PrivateMessage[],
  incoming: PrivateMessage[],
  reviews: PrivateMessage[],
  unavailableIds: number[],
  deletedIds: Set<number>,
  reviewCache: Map<number, PrivateMessage>
) => {
  unavailableIds.forEach((id) => deletedIds.add(id))
  const messages = new Map(current.map((message) => [message.id, message]))
  for (const message of [...incoming, ...reviews]) {
    if (message.isDeleted) deletedIds.add(message.id)
    const previous = reviewCache.get(message.id) ?? messages.get(message.id)
    const updated =
      previous?.editedAt &&
      (!message.editedAt ||
        new Date(previous.editedAt).getTime() >
          new Date(message.editedAt).getTime())
        ? previous
        : message
    reviewCache.set(
      message.id,
      deletedIds.has(message.id) ? deletedChatMessage(updated) : updated
    )
  }
  for (const message of incoming)
    messages.set(message.id, reviewCache.get(message.id)!)
  for (const message of reviews) {
    if (messages.has(message.id))
      messages.set(message.id, reviewCache.get(message.id)!)
  }
  for (const id of deletedIds) {
    reviewCache.delete(id)
    const message = messages.get(id)
    if (message) messages.set(id, deletedChatMessage(message))
  }
  return [...messages.values()]
    .map((message) => {
      const reply = message.replyTo
      if (!reply) return message
      if (deletedIds.has(reply.messageId)) return { ...message, replyTo: null }
      const target = reviewCache.get(reply.messageId)
      if (!target?.editedAt) return message
      return {
        ...message,
        replyTo: {
          ...reply,
          content: target.content.slice(0, 500),
          selectedText: null
        }
      }
    })
    .sort((left, right) => left.id - right.id)
}

export const chatReviewTargets = (
  priorityIds: number[],
  visibleMessages: PrivateMessage[]
) =>
  [
    ...new Set([
      ...priorityIds,
      ...visibleMessages.flatMap((message) => [
        message.id,
        ...(message.replyTo ? [message.replyTo.messageId] : [])
      ])
    ])
  ].filter((id) => Number.isSafeInteger(id) && id > 0)
