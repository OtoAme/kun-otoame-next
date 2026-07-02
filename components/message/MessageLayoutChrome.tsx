'use client'

import { useEffect, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { MessageNav } from '~/components/message/MessageNav'
import { KunHeader } from '~/components/kun/Header'
import { isMessageChatConversationPath } from '~/constants/routes/matcher'
import { cn } from '~/utils/cn'

const MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT =
  '--message-chat-visual-viewport-height'

export const MessageLayoutChrome = ({
  children
}: {
  children: React.ReactNode
}) => {
  const pathname = usePathname()
  const isConversationDetail = isMessageChatConversationPath(pathname)
  const conversationDetailStyle = isConversationDetail
    ? ({ '--message-chat-top-reserve': '3dvh' } as CSSProperties)
    : undefined

  useEffect(() => {
    if (!isConversationDetail) {
      return
    }

    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousViewportHeight = html.style.getPropertyValue(
      MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT
    )

    const updateVisualViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      html.style.setProperty(
        MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT,
        `${Math.round(height)}px`
      )
    }

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    updateVisualViewportHeight()

    window.addEventListener('resize', updateVisualViewportHeight)
    window.visualViewport?.addEventListener(
      'resize',
      updateVisualViewportHeight
    )
    window.visualViewport?.addEventListener(
      'scroll',
      updateVisualViewportHeight
    )

    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
      if (previousViewportHeight) {
        html.style.setProperty(
          MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT,
          previousViewportHeight
        )
      } else {
        html.style.removeProperty(MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT)
      }
      window.removeEventListener('resize', updateVisualViewportHeight)
      window.visualViewport?.removeEventListener(
        'resize',
        updateVisualViewportHeight
      )
      window.visualViewport?.removeEventListener(
        'scroll',
        updateVisualViewportHeight
      )
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
