'use client'

import { useEffect, useState } from 'react'
import { kunFetchGet, kunFetchPut } from '~/utils/kunFetch'
import { Button } from '@heroui/react'
import { AtSign, Bell, Globe, MessageSquare, UserPlus } from 'lucide-react'
import { Card, CardBody } from '@heroui/card'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'

const notificationSubTypes = [
  { type: 'notice', label: '全部消息', icon: Bell, href: '/message/notice' },
  {
    type: 'follow',
    label: '关注消息',
    icon: UserPlus,
    href: '/message/follow'
  },
  {
    type: 'mention',
    label: '@ 消息',
    icon: AtSign,
    href: '/message/mention'
  },
  { type: 'system', label: '系统消息', icon: Globe, href: '/message/system' }
]

export const MessageNav = () => {
  const pathname = usePathname()
  const pathSegments = pathname.split('/').filter(Boolean)
  const lastSegment = pathSegments[pathSegments.length - 1]

  const isNotificationSection = notificationSubTypes.some(
    (item) => item.type === lastSegment
  )
  const isChatSection = pathname.startsWith('/message/chat')

  const [hasUnreadMessages, setHasUnreadMessages] = useState(false)
  const [hasUnreadChat, setHasUnreadChat] = useState(false)

  useEffect(() => {
    const fetchUnread = async () => {
      const res = await kunFetchGet<{
        hasUnreadMessages: boolean
        hasUnreadChat: boolean
      }>('/message/unread')
      if (res && typeof res !== 'string') {
        setHasUnreadMessages(res.hasUnreadMessages)
        setHasUnreadChat(res.hasUnreadChat)
      }
    }
    fetchUnread()
  }, [])

  useEffect(() => {
    if (!isNotificationSection) {
      return
    }
    setHasUnreadMessages(false)
    const readAllMessage = async () => {
      const res = await kunFetchPut<KunResponse<{}>>('/message/read')
      if (typeof res === 'string') {
        toast.error(res)
      }
    }
    readAllMessage()
  }, [isNotificationSection])

  useEffect(() => {
    if (isChatSection) {
      setHasUnreadChat(false)
    }
  }, [pathname])

  const showMessageDot = hasUnreadMessages && !isNotificationSection
  const showChatDot = hasUnreadChat && !isChatSection

  return (
    <Card className="w-full lg:w-1/4">
      <CardBody className="flex flex-col gap-2">
        <div className="flex flex-row gap-2 lg:flex-col">
          <Button
            color={isNotificationSection ? 'primary' : 'default'}
            as={Link}
            className="justify-start w-full"
            variant={isNotificationSection ? 'solid' : 'light'}
            startContent={<Bell className="size-4 shrink-0" />}
            href="/message/notice"
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

        {isNotificationSection && (
          <>
            <div className="border-t border-default-200 my-2" />
            <div className="flex flex-row gap-2 lg:flex-col">
              {notificationSubTypes.map(({ type, label, icon: Icon, href }) => (
                <Button
                  key={type}
                  color={lastSegment === type ? 'secondary' : 'default'}
                  as={Link}
                  className="justify-start w-full"
                  variant={lastSegment === type ? 'flat' : 'light'}
                  size="sm"
                  startContent={<Icon className="size-3.5 shrink-0" />}
                  href={href}
                >
                  <span>{label}</span>
                </Button>
              ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
