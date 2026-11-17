'use client'

import { useEffect } from 'react'
import { kunFetchPut } from '~/utils/kunFetch'
import { Button } from '@heroui/react'
import { AtSign, Bell, Globe, MessageSquare, UserPlus } from 'lucide-react'
import { Card, CardBody } from '@heroui/card'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useMessageStore } from '~/store/messageStore'
import { cn } from '~/utils/cn'
import { useUserStore } from '~/store/userStore'
import { refreshUnreadSummary } from '~/utils/messageSync'
import type { MessageUnreadStatus } from '~/types/api/message'

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

export const MessageNav = ({ className }: { className?: string }) => {
  const pathname = usePathname()
  const pathSegments = pathname.split('/').filter(Boolean)
  const lastSegment = pathSegments[pathSegments.length - 1]

  const isNotificationSection = notificationSubTypes.some(
    (item) => item.type === lastSegment
  )
  const isChatSection = pathname.startsWith('/message/chat')

  const hasUnreadNotification = useMessageStore(
    (state) => state.hasUnreadNotification
  )
  const hasUnreadConversation = useMessageStore(
    (state) => state.hasUnreadConversation
  )
  const setHasUnreadNotification = useMessageStore(
    (state) => state.setHasUnreadNotification
  )
  const setUnreadMessageStatus = useMessageStore(
    (state) => state.setUnreadMessageStatus
  )

  const { sessionStatus, sessionContext, sessionGeneration } = useUserStore()

  useEffect(() => {
    if (
      !isNotificationSection ||
      sessionStatus !== 'authenticated' ||
      !sessionContext
    )
      return
    let ignore = false
    const controller = new AbortController()
    const context = sessionContext
    const generation = sessionGeneration
    const isCurrent = () => {
      const state = useUserStore.getState()
      return (
        !ignore &&
        state.sessionStatus === 'authenticated' &&
        state.sessionContext === context &&
        state.sessionGeneration === generation
      )
    }
    const previousUnread = useMessageStore.getState().hasUnreadNotification
    const restoreUnreadStatus = () => {
      if (!isCurrent()) return
      setHasUnreadNotification(
        previousUnread || useMessageStore.getState().hasUnreadNotification
      )
      refreshUnreadSummary('manual')
    }
    setHasUnreadNotification(false)
    const markNotificationsRead = async () => {
      try {
        const response = await kunFetchPut<KunResponse<MessageUnreadStatus>>(
          '/message/read',
          undefined,
          {
            timeout: 15_000,
            signal: controller.signal,
            preserveErrorStatus: true
          }
        )
        if (!isCurrent()) return
        if (
          !response ||
          typeof response === 'string' ||
          typeof response.hasUnreadNotification !== 'boolean' ||
          typeof response.hasUnreadConversation !== 'boolean'
        ) {
          if (typeof response === 'string') toast.error(response)
          restoreUnreadStatus()
          return
        }
        setUnreadMessageStatus(response)
      } catch {
        if (!isCurrent()) return
        toast.error('标记消息已读失败，请稍后重试')
        restoreUnreadStatus()
      }
    }
    void markNotificationsRead()
    return () => {
      ignore = true
      controller.abort()
    }
  }, [
    isNotificationSection,
    sessionStatus,
    sessionContext,
    sessionGeneration,
    setHasUnreadNotification,
    setUnreadMessageStatus
  ])

  const showMessageDot = hasUnreadNotification && !isNotificationSection
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
