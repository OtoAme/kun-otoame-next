'use client'

import { useEffect, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { MessageNav } from '~/components/message/MessageNav'
import { KunHeader } from '~/components/kun/Header'
import { isMessageChatConversationPath } from '~/constants/routes/matcher'
import { cn } from '~/utils/cn'

export const MessageLayoutChrome = ({
  children
}: {
  children: React.ReactNode
}) => {
  const pathname = usePathname()
  const isConversationDetail = isMessageChatConversationPath(pathname)
  const conversationDetailStyle = isConversationDetail
    ? ({ '--message-chat-top-reserve': '4dvh' } as CSSProperties)
    : undefined

  useEffect(() => {
    if (!isConversationDetail) {
      return
    }

    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [isConversationDetail])

  return (
    <div
      style={conversationDetailStyle}
      className={cn(
        isConversationDetail
          ? 'container mx-auto min-h-[calc(100dvh-256px)] w-full overflow-visible pt-[var(--message-chat-top-reserve)]'
          : 'container mx-auto my-4'
      )}
    >
      {!isConversationDetail && (
        <KunHeader
          name="消息"
          description="这是消息页面, 第一次访问对应的页面会自动已读所有消息"
        />
      )}
      <div
        className={cn(
          isConversationDetail
            ? 'flex w-full flex-col gap-6 overflow-visible lg:flex-row lg:items-start'
            : 'flex flex-col my-4 gap-6 lg:flex-row'
        )}
      >
        <MessageNav
          className={isConversationDetail ? 'max-lg:hidden' : undefined}
        />
        <div className="w-full lg:w-3/4">{children}</div>
      </div>
    </div>
  )
}
