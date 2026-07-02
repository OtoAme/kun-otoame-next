import { ChatContainer } from '~/components/message/chat/ChatContainer'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { parseConversationRouteId } from '~/app/api/message/conversation/routeParams'
import { kunGetConversationMessagesAction } from '../actions'
import { privateChatMetadata } from '../metadata'

export const revalidate = 0

export const metadata = privateChatMetadata

interface Props {
  params: Promise<{ conversationId: string }>
}

export default async function Kun({ params }: Props) {
  const { conversationId } = await params
  const id = parseConversationRouteId(conversationId)

  if (id === null) {
    return <ErrorComponent error="无效的会话 ID" />
  }

  const response = await kunGetConversationMessagesAction(id, {
    page: 1,
    limit: 30
  })

  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <ChatContainer
      conversationId={id}
      initialMessages={response.messages}
      total={response.total}
      hasMoreBefore={response.hasMoreBefore}
      otherUser={response.otherUser}
      className="h-[calc(100dvh_-_192px_-_var(--message-chat-top-reserve))]"
    />
  )
}
