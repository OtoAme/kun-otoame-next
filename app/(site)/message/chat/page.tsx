import { ConversationList } from '~/components/message/chat/ConversationList'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { kunGetConversationsAction } from './actions'
import { privateChatMetadata } from './metadata'

export const revalidate = 0

export const metadata = privateChatMetadata

export default async function Kun() {
  const response = await kunGetConversationsAction({ page: 1, limit: 30 })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <ConversationList
      initialConversations={response.conversations}
      total={response.total}
    />
  )
}
