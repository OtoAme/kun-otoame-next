'use client'

import { Button } from '@heroui/react'
import { Bell, MessageSquare } from 'lucide-react'
import { Card, CardBody } from '@heroui/card'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useMessageStore } from '~/store/messageStore'
import { cn } from '~/utils/cn'

export const MessageNav = ({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}) => {
  const pathname = usePathname()
  const isNotificationSection =
    /^\/message\/(notice|follow|mention|system)$/.test(pathname)
  const isChatSection = pathname.startsWith('/message/chat')

  const hasUnreadNotification = useMessageStore(
    (state) => state.hasUnreadNotification
  )
  const hasUnreadConversation = useMessageStore(
    (state) => state.hasUnreadConversation
  )

  const showMessageDot = hasUnreadNotification
  const showChatDot = hasUnreadConversation && !isChatSection

  return (
    <Card className={cn('w-full lg:w-1/4', className)}>
      <CardBody className="flex flex-col gap-2">
        <div className="flex flex-row gap-2 lg:flex-col">
          <Button
            color={isNotificationSection ? 'primary' : 'default'}
            as={Link}
            className="justify-start w-full"
            variant={isNotificationSection ? 'solid' : 'light'}
            startContent={<Bell className="size-4 shrink-0" />}
            href={
              hasUnreadNotification
                ? '/message/notice?state=unread'
                : '/message/notice'
            }
          >
            <span className="relative">
              消息
              {showMessageDot && (
                <span className="absolute -top-0.5 -right-2.5 size-2 rounded-full bg-danger" />
              )}
            </span>
          </Button>
          <Button
            color={isChatSection ? 'primary' : 'default'}
            as={Link}
            className="justify-start w-full"
            variant={isChatSection ? 'solid' : 'light'}
            startContent={<MessageSquare className="size-4 shrink-0" />}
            href="/message/chat"
          >
            <span className="relative">
              私聊
              {showChatDot && (
                <span className="absolute -top-0.5 -right-2.5 size-2 rounded-full bg-danger" />
              )}
            </span>
          </Button>
        </div>
        {children && (
          <>
            <div className="border-t border-default-200 my-2" />
            {children}
          </>
        )}
      </CardBody>
    </Card>
  )
}
