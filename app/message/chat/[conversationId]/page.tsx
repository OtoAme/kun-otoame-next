import { ChatContainer } from '~/components/message/chat/ChatContainer'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { parseConversationRouteId } from '~/app/api/message/conversation/routeParams'
import { kunGetConversationMessagesAction } from '../actions'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = {
  title: '私聊'
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
    <>
      <KunBreadcrumbTitle
        routeKey={`/message/chat/${id}`}
        title={`与${response.otherUser.name}的私聊`}
      />
      <ChatContainer
        conversationId={id}
        initialMessages={response.messages}
        total={response.total}
        hasMoreBefore={response.hasMoreBefore}
        otherUser={response.otherUser}
      />
    </>
  )
}
