'use client'

import { useEffect, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { MessageNav } from '~/components/message/MessageNav'
import { KunHeader } from '~/components/kun/Header'
import { isMessageChatConversationPath } from '~/constants/routes/matcher'
import { cn } from '~/utils/cn'

const MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT =
  '--message-chat-visual-viewport-height'
const MESSAGE_CHAT_VISUAL_VIEWPORT_OFFSET_TOP =
  '--message-chat-visual-viewport-offset-top'

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
    const previousViewportHeight = html.style.getPropertyValue(
      MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT
    )
    const previousViewportOffsetTop = html.style.getPropertyValue(
      MESSAGE_CHAT_VISUAL_VIEWPORT_OFFSET_TOP
    )

    let scrollResetFrame: number | null = null
    let scrollResetTimer: number | null = null

    const cancelScheduledScrollReset = () => {
      if (scrollResetFrame !== null) {
        window.cancelAnimationFrame?.(scrollResetFrame)
        scrollResetFrame = null
      }
      if (scrollResetTimer !== null) {
        window.clearTimeout(scrollResetTimer)
        scrollResetTimer = null
      }
    }

    const resetDocumentScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0)
      }
    }

    const scheduleDocumentScrollReset = () => {
      resetDocumentScroll()
      cancelScheduledScrollReset()

      if (typeof window.requestAnimationFrame === 'function') {
        scrollResetFrame = window.requestAnimationFrame(() => {
          scrollResetFrame = null
          resetDocumentScroll()
        })
      }

      scrollResetTimer = window.setTimeout(() => {
        scrollResetTimer = null
        resetDocumentScroll()
      }, 80)
    }

    const updateVisualViewportMetrics = () => {
      const vv = window.visualViewport
      if (!vv) {
        const fallbackHeight = window.innerHeight
        html.style.setProperty(
          MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT,
          `${Math.round(fallbackHeight)}px`
        )
        html.style.setProperty(MESSAGE_CHAT_VISUAL_VIEWPORT_OFFSET_TOP, '0px')
        scheduleDocumentScrollReset()
        return
      }

      html.style.setProperty(
        MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT,
        `${Math.round(vv.height)}px`
      )
      html.style.setProperty(
        MESSAGE_CHAT_VISUAL_VIEWPORT_OFFSET_TOP,
        `${Math.max(0, Math.round(vv.offsetTop))}px`
      )
      scheduleDocumentScrollReset()
    }

    const handleWindowScroll = () => scheduleDocumentScrollReset()

    updateVisualViewportMetrics()

    window.visualViewport?.addEventListener(
      'resize',
      updateVisualViewportMetrics
    )
    window.visualViewport?.addEventListener(
      'scroll',
      updateVisualViewportMetrics
    )
    window.addEventListener('resize', updateVisualViewportMetrics)
    window.addEventListener('orientationchange', updateVisualViewportMetrics)
    window.addEventListener('focusin', scheduleDocumentScrollReset)
    window.addEventListener('scroll', handleWindowScroll, { passive: true })

    return () => {
      cancelScheduledScrollReset()

      if (previousViewportHeight) {
        html.style.setProperty(
          MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT,
          previousViewportHeight
        )
      } else {
        html.style.removeProperty(MESSAGE_CHAT_VISUAL_VIEWPORT_HEIGHT)
      }

      if (previousViewportOffsetTop) {
        html.style.setProperty(
          MESSAGE_CHAT_VISUAL_VIEWPORT_OFFSET_TOP,
          previousViewportOffsetTop
        )
      } else {
        html.style.removeProperty(MESSAGE_CHAT_VISUAL_VIEWPORT_OFFSET_TOP)
      }

      window.visualViewport?.removeEventListener(
        'resize',
        updateVisualViewportMetrics
      )
      window.visualViewport?.removeEventListener(
        'scroll',
        updateVisualViewportMetrics
      )
      window.removeEventListener('resize', updateVisualViewportMetrics)
      window.removeEventListener(
        'orientationchange',
        updateVisualViewportMetrics
      )
      window.removeEventListener('focusin', scheduleDocumentScrollReset)
      window.removeEventListener('scroll', handleWindowScroll)
    }
  }, [isConversationDetail])

  useEffect(() => {
    return () => {
      const body = document.body
      const html = document.documentElement

      body.classList.remove('yarl__no_scroll')
      body.classList.remove('yarl__no_scroll_padding')
      html.classList.remove('yarl__no_scroll')
      html.classList.remove('yarl__no_scroll_padding')
    }
  }, [])

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
