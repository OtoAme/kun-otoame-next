'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Avatar } from '@heroui/avatar'
import { Chip } from '@heroui/chip'
import { formatTimeDifference } from '~/utils/time'
import { generateUUID } from '~/utils/random'
import { notificationContent } from '~/utils/notificationContent'
import {
  AtSign,
  Bell,
  GitPullRequestArrow,
  Heart,
  Mail,
  MessageCircle,
  MonitorCog,
  ThumbsUp,
  Users
} from 'lucide-react'
import { MESSAGE_TYPE_MAP } from '~/constants/message'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { useSessionContentReady } from '~/components/kun/SessionContentBoundary'
import {
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_EVENTS,
  notificationCategory
} from '~/constants/notification'
import {
  isNotificationCardVisible,
  observeNotificationReading
} from '~/utils/notificationVisibility'
import {
  rememberNotificationEntry,
  notificationEntryHref,
  type NotificationIdentity
} from '~/utils/notificationReading'
import type { Message } from '~/types/api/message'

interface Props {
  msg: Message
  identity?: NotificationIdentity
  onSeen?: (
    message: Message,
    eligible?: () => boolean,
    immediate?: boolean
  ) => void
  justRead?: boolean
  confirmationError?: string
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'system':
      return <MonitorCog className="size-5 text-secondary-500" />
    case 'pm':
      return <Mail className="size-5 text-secondary-500" />
    case 'like':
      return <ThumbsUp className="size-5 text-secondary-500" />
    case 'favorite':
      return <Heart className="size-5 text-danger-500" />
    case 'comment':
      return <MessageCircle className="size-5 text-primary-500" />
    case 'pr':
      return <GitPullRequestArrow className="size-5 text-success-500" />
    case 'follow':
      return <Users className="size-5 text-success-500" />
    case 'mention':
      return <AtSign className="size-5 text-success-500" />
    default:
      return <Bell className="size-5 text-default-500" />
  }
}

const getCardRoute = (msg: Message) => {
  // 已有链接优先（如事项通知的 /issue/id、管理员的 /dashboard/case/id）；
  // 无链接时保持原兜底：有 sender 去其评论页，无 sender 回首页。
  if (msg.link) {
    return msg.link
  }
  if (!msg.sender) {
    return '/'
  }
  return `/user/${msg.sender.id}/comment`
}

export const MessageCard = ({
  msg,
  identity,
  onSeen,
  justRead,
  confirmationError
}: Props) => {
  const contentReady = useSessionContentReady()
  const href = getCardRoute(msg)
  const token = useMemo(generateUUID, [msg.id, msg.contentVersion])
  const entryHref =
    identity && msg.status === 0 && msg.contentVersion && msg.link
      ? notificationEntryHref(href, token)
      : href
  const remember = () => {
    if (identity && msg.status === 0 && msg.contentVersion && msg.link)
      rememberNotificationEntry(token, {
        identity,
        item: { id: msg.id, version: msg.contentVersion },
        target: msg.link
      })
  }
  const card = useRef<HTMLDivElement>(null)
  const content = notificationContent(msg)
  const long = content.body.length > 350 || content.body.split('\n').length > 8
  const [expanded, setExpanded] = useState(false)
  const category = msg.category ?? notificationCategory(msg.eventType, msg.type)

  useEffect(() => {
    if (
      !card.current ||
      !contentReady ||
      !identity ||
      !onSeen ||
      msg.status !== 0 ||
      !msg.contentVersion ||
      confirmationError
    )
      return
    let active = true
    const eligible = () =>
      active && Boolean(card.current && isNotificationCardVisible(card.current))
    const stop = observeNotificationReading(
      card.current,
      () => onSeen(msg, eligible),
      1000,
      'card'
    )
    return () => {
      active = false
      stop()
    }
  }, [msg, identity, onSeen, confirmationError, contentReady])

  return (
    <Card
      ref={card}
      data-notification-id={msg.id}
      className="w-full border border-default-100 dark:border-default-200"
    >
      <CardBody className="flex flex-row items-start gap-3 sm:gap-4">
        {msg.sender ? (
          <KunAvatar
            uid={msg.sender.id}
            avatarProps={{
              src: msg.sender.avatar,
              name: msg.sender.name
            }}
          />
        ) : (
          <Avatar src="/favicon.webp" name="系统消息" />
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {getNotificationIcon(msg.type)}

            <span className="font-semibold">
              {msg.sender ? msg.sender.name : '系统'}
            </span>

            <span>
              {msg.eventType
                ? NOTIFICATION_EVENTS[msg.eventType]?.label
                : MESSAGE_TYPE_MAP[msg.type]}
            </span>
            <span className="text-xs text-default-500">
              {NOTIFICATION_CATEGORY_LABELS[category]}
            </span>
          </div>
          <div
            data-testid="message-content"
            className="space-y-2 whitespace-pre-wrap break-words text-default-600"
          >
            {content.template && <p>{content.template}</p>}
            <blockquote className="rounded-r-medium border-l-3 border-default-300 bg-default-50 px-4 py-3">
              <p className={long && !expanded ? 'line-clamp-5' : undefined}>
                {content.body}
              </p>
            </blockquote>
          </div>
          {long && (
            <Button
              size="sm"
              variant="light"
              aria-expanded={expanded}
              onPress={() => {
                setExpanded(!expanded)
                if (
                  !expanded &&
                  contentReady &&
                  identity &&
                  msg.status === 0 &&
                  msg.contentVersion
                )
                  onSeen?.(msg, undefined, true)
              }}
            >
              {expanded ? '收起正文' : '展开完整正文'}
            </Button>
          )}
          <Link
            href={entryHref}
            prefetch={false}
            className="inline-flex text-primary underline underline-offset-4"
            onClick={remember}
            onAuxClick={remember}
            onContextMenu={remember}
          >
            查看详情
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <span className="text-sm text-default-400">
                {formatTimeDifference(msg.created)}
              </span>
              {msg.updated &&
                new Date(msg.updated).getTime() >
                  new Date(msg.created).getTime() + 1000 && (
                  <p className="text-xs text-default-500">
                    最近更新：{formatTimeDifference(msg.updated)}
                  </p>
                )}
            </div>
            <Chip color={msg.status === 0 ? 'danger' : 'default'} size="sm">
              {msg.status === 0 ? '未读' : justRead ? '刚刚已读' : '已阅读'}
            </Chip>
          </div>
          {confirmationError && (
            <p role="status" className="text-sm text-warning-600">
              {confirmationError}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
