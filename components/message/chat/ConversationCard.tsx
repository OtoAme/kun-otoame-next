import Link from 'next/link'
import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { formatTimeDifference } from '~/utils/time'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import type { Conversation } from '~/types/api/conversation'

interface Props {
  conversation: Conversation
}

export const ConversationCard = ({ conversation }: Props) => {
  return (
    <Card
      isPressable
      as={Link}
      href={`/message/chat/${conversation.id}`}
      prefetch={false}
      className="w-full border border-[var(--kun-chat-list-card-border)] bg-[var(--kun-chat-list-card-bg)] text-[var(--kun-chat-text-primary)] transition-colors hover:bg-[var(--kun-chat-list-card-hover-bg)]"
    >
      <CardBody className="flex flex-row items-center gap-4">
        <KunAvatar
          uid={conversation.otherUser.id}
          avatarProps={{
            src: conversation.otherUser.avatar,
            name: conversation.otherUser.name
          }}
        />

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold truncate">
              {conversation.otherUser.name}
            </span>
            <span className="ml-2 shrink-0 text-xs text-[var(--kun-chat-muted-text)]">
              {formatTimeDifference(conversation.lastMessageTime)}
            </span>
          </div>
          <p className="truncate text-sm text-[var(--kun-chat-text-secondary)]">
            {conversation.lastMessage || '暂无消息'}
          </p>
        </div>

        {conversation.unreadCount > 0 && (
          <Chip color="danger" size="sm" variant="solid">
            {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
          </Chip>
        )}
      </CardBody>
    </Card>
  )
}
