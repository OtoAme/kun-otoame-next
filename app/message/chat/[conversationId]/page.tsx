import { ChatContainer } from '~/components/message/chat/ChatContainer'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { parseConversationRouteId } from '~/app/api/message/conversation/routeParams'
import { kunViewport } from '~/app/metadata'
import { kunGetConversationMessagesAction } from '../actions'
import { privateChatMetadata } from '../metadata'
import type { Viewport } from 'next'

export const revalidate = 0

export const metadata = privateChatMetadata
export const viewport: Viewport = {
  ...kunViewport,
  interactiveWidget: 'resizes-content'
}

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
      className="h-[calc(100dvh_-_192px_-_var(--message-chat-top-reserve))] max-lg:h-[calc(var(--message-chat-visual-viewport-height,100dvh)_-_96px_-_var(--message-chat-top-reserve))] max-lg:max-h-[calc(var(--message-chat-visual-viewport-height,100dvh)_-_96px_-_var(--message-chat-top-reserve))] max-lg:min-h-0 max-lg:translate-y-[var(--message-chat-visual-viewport-offset-top,0px)] max-lg:transition-[height,max-height,transform] max-lg:duration-150 max-lg:ease-out motion-reduce:transition-none"
    />
  )
}
