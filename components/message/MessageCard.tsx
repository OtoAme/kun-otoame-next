'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Avatar } from '@heroui/avatar'
import { Chip } from '@heroui/chip'
import { formatTimeDifference } from '~/utils/time'
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
import {
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_EVENTS,
  notificationCategory
} from '~/constants/notification'
import {
  isNotificationBodyVisible,
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
  onSeen?: (message: Message, eligible?: () => boolean) => void
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
  const href = getCardRoute(msg)
  const token = useMemo(() => crypto.randomUUID(), [msg.id, msg.contentVersion])
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
  const body = useRef<HTMLParagraphElement>(null)
  const long = msg.content.length > 350 || msg.content.split('\n').length > 8
  const [expanded, setExpanded] = useState(false)
  const canRead = !long || expanded
  const category = msg.category ?? notificationCategory(msg.eventType, msg.type)

  useEffect(() => {
    if (
      !body.current ||
      !identity ||
      !onSeen ||
      !canRead ||
      msg.status !== 0 ||
      !msg.contentVersion ||
      confirmationError
    )
      return
    let active = true
    const eligible = () =>
      active && Boolean(body.current && isNotificationBodyVisible(body.current))
    const stop = observeNotificationReading(body.current, () =>
      onSeen(msg, eligible)
    )
    return () => {
      active = false
      stop()
    }
  }, [msg, identity, onSeen, canRead, confirmationError])

  return (
    <Card
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
            {!msg.eventType && msg.type === 'system' && (
              <span className="text-xs text-default-500">
                历史系统通知 · 事件未细分
              </span>
            )}
          </div>
          <p
            ref={body}
            data-testid="message-content"
            className={`whitespace-pre-wrap break-words text-default-600 ${long && !expanded ? 'line-clamp-5' : ''}`}
          >
            {msg.content}
          </p>
          {long && (
            <Button
              size="sm"
              variant="light"
              aria-expanded={expanded}
              onPress={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起正文' : '展开完整正文'}
            </Button>
          )}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={entryHref}
              prefetch={false}
              className="text-primary underline underline-offset-4"
              onClick={remember}
              onAuxClick={remember}
              onContextMenu={remember}
            >
              查看详情
            </Link>
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
