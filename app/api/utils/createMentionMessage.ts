import { prisma } from '~/prisma/index'
import { markdownToText } from '~/utils/markdownToText'
import type { CreateMessageType } from '~/types/api/message'

export const MAX_MENTION_NOTIFICATIONS_PER_COMMENT = 20

export const extractMentionUserIds = (text: string) => {
  const regex = /\[@[^\]]+\]\(\/user\/(\d+)\/resource\)/g
  return [...text.matchAll(regex)].map((match) => Number(match[1]))
}

const getMentionCandidateUserIds = (text: string, senderUid: number) => {
  const seen = new Set<number>()
  const userIds: number[] = []

  for (const mentionUid of extractMentionUserIds(text)) {
    if (
      mentionUid === senderUid ||
      seen.has(mentionUid) ||
      !Number.isSafeInteger(mentionUid)
    ) {
      continue
    }

    seen.add(mentionUid)
    userIds.push(mentionUid)

    if (userIds.length >= MAX_MENTION_NOTIFICATIONS_PER_COMMENT) {
      break
    }
  }

  return userIds
}

export const createMentionMessage = async (
  uniqueId: string,
  patchName: string,
  commentId: number,
  senderUid: number,
  senderUsername: string,
  text: string
) => {
  const candidateUserIds = getMentionCandidateUserIds(text, senderUid)
  if (!candidateUserIds.length) {
    return
  }

  const users = await prisma.user.findMany({
    where: { id: { in: candidateUserIds } },
    select: { id: true }
  })
  const existingUserIds = new Set(users.map((user) => user.id))
  const mentionedUserIds = candidateUserIds.filter((id) =>
    existingUserIds.has(id)
  )

  if (!mentionedUserIds.length) {
    return
  }

  const mentionText = markdownToText(text).slice(0, 50)
  const mentionMessageData: CreateMessageType[] = mentionedUserIds.map(
    (mentionUid) => ({
      type: 'mention',
      content: `${senderUsername} 在「${patchName}」的评论区提到了您\n${mentionText}`,
      sender_id: senderUid,
      recipient_id: mentionUid,
      link: `/${uniqueId}?tab=comments&commentId=${commentId}`
    })
  )

  await prisma.user_message.createMany({
    data: mentionMessageData
  })
}
