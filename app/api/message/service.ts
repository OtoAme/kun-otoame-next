import { z } from 'zod'
import { createMessage } from '~/app/api/utils/message'
import { createMessageSchema } from '~/validations/message'

export const create = async (
  input: z.infer<typeof createMessageSchema>,
  uid: number
) => {
  const { type, content, recipientId, link } = input

  const message = await createMessage({
    type,
    content,
    sender_id: uid,
    recipient_id: recipientId,
    link
  })

  return message
}
