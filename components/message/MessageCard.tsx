'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Avatar } from '@heroui/avatar'
import { Chip } from '@heroui/chip'
import { formatTimeDifference } from '~/utils/time'
import { generateUUID } from '~/utils/random'
import { NotificationMarkdown } from './NotificationMarkdown'
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
  showCategory?: boolean
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
  showCategory = true,
  justRead,
  confirmationError
}: Props) => {
  const contentReady = useSessionContentReady()
  const headingId = useId()
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
  const long = msg.content.length > 350 || msg.content.split('\n').length > 8
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
      className="relative w-full border border-default-100 transition-shadow hover:shadow-medium dark:border-default-200"
    >
      <Link
        href={entryHref}
        prefetch={false}
        aria-labelledby={headingId}
        onClick={remember}
        onAuxClick={remember}
        onContextMenu={remember}
        className="absolute inset-0 z-10 rounded-large outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      />
      <CardBody className="flex flex-row items-start gap-3 sm:gap-4">
        {msg.sender ? (
          <KunAvatar
            uid={msg.sender.id}
            avatarProps={{
              src: msg.sender.avatar,
              name: msg.sender.name,
              classNames: { base: 'relative z-20' }
            }}
          />
        ) : (
          <Avatar
            className="relative z-20"
            src="/favicon.webp"
            name="系统消息"
          />
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div
            id={headingId}
            className="flex flex-wrap items-center gap-2 [&>*]:relative [&>*]:z-20"
          >
            {getNotificationIcon(msg.type)}

            <span className="font-semibold">
              {msg.sender ? msg.sender.name : '系统'}
            </span>

            <span>
              {msg.eventType
                ? NOTIFICATION_EVENTS[msg.eventType]?.label
                : MESSAGE_TYPE_MAP[msg.type]}
            </span>
            {showCategory && (
              <span className="text-xs text-default-500">
                {NOTIFICATION_CATEGORY_LABELS[category]}
              </span>
            )}
          </div>
          <div
            data-testid="message-content"
            className={`relative z-20 cursor-text select-text space-y-2 whitespace-pre-wrap break-words text-default-600 ${long && !expanded ? 'line-clamp-5 max-h-[calc(5lh+1.5rem)]' : ''}`}
          >
            {content.map((part, index) =>
              part.quoted ? (
                <blockquote
                  key={index}
                  className="rounded-r-medium border-l-3 border-default-300 bg-default-50 px-4 py-3"
                >
                  {part.markdown ? (
                    <NotificationMarkdown text={part.text} />
                  ) : (
                    part.text
                  )}
                </blockquote>
              ) : (
                <p key={index}>
                  {part.inlineExcerpt ? (
                    <>
                      {part.inlineExcerpt.before}
                      <NotificationMarkdown
                        inlineOnly
                        text={part.inlineExcerpt.source}
                      />
                      {part.inlineExcerpt.after}
                    </>
                  ) : (
                    part.text
                  )}
                </p>
              )
            )}
          </div>
          {long && (
            <Button
              className="relative z-20"
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative z-20 space-y-1">
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
            <Chip
              className="relative z-20"
              color={msg.status === 0 ? 'danger' : 'default'}
              size="sm"
            >
              {msg.status === 0 ? '未读' : justRead ? '刚刚已读' : '已阅读'}
            </Chip>
          </div>
          {confirmationError && (
            <p role="status" className="relative z-20 text-sm text-warning-600">
              {confirmationError}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
