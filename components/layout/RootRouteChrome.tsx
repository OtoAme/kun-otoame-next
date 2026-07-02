'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { KunBackToTop } from '~/components/kun/BackToTop'
import { KunFooter } from '~/components/kun/Footer'
import { isMessageChatConversationPath } from '~/constants/routes/matcher'
import { cn } from '~/utils/cn'

export const KunRootRouteChrome = ({
  children
}: {
  children: React.ReactNode
}) => {
  const pathname = usePathname()
  const isConversationDetail = isMessageChatConversationPath(pathname)
  const isConversationDetailRef = useRef(isConversationDetail)
  const documentOverflowRef = useRef<{
    html: string
    body: string
    htmlY: string
    bodyY: string
  } | null>(null)
  const unlockFrameRef = useRef<number | null>(null)
  const unlockTimerRef = useRef<number | null>(null)

  isConversationDetailRef.current = isConversationDetail

  useEffect(() => {
    const html = document.documentElement
    const body = document.body

    const cancelScheduledUnlock = () => {
      if (unlockFrameRef.current !== null) {
        window.cancelAnimationFrame?.(unlockFrameRef.current)
        unlockFrameRef.current = null
      }
      if (unlockTimerRef.current !== null) {
        window.clearTimeout(unlockTimerRef.current)
        unlockTimerRef.current = null
      }
    }

    const blurActiveElement = () => {
      const activeElement = document.activeElement

      if (activeElement && activeElement !== body && 'blur' in activeElement) {
        const elementWithBlur = activeElement as HTMLElement
        elementWithBlur.blur()
      }
    }

    const unlockDocumentScroll = (confirmMobileScroll = false) => {
      const previousOverflow = documentOverflowRef.current

      if (previousOverflow) {
        html.style.overflow =
          previousOverflow.html === 'hidden' ? '' : previousOverflow.html
        body.style.overflow =
          previousOverflow.body === 'hidden' ? '' : previousOverflow.body
        html.style.overflowY =
          previousOverflow.htmlY === 'hidden' ? '' : previousOverflow.htmlY
        body.style.overflowY =
          previousOverflow.bodyY === 'hidden' ? '' : previousOverflow.bodyY
        documentOverflowRef.current = null
      } else {
        html.style.overflow = ''
        body.style.overflow = ''
        html.style.overflowY = ''
        body.style.overflowY = ''
      }

      if (body.style.position === 'fixed') {
        const scrollY = body.style.top
        body.style.position = ''
        body.style.top = ''
        body.style.width = ''
        if (scrollY) {
          const scrollPosition = parseInt(scrollY.replace('px', ''), 10) * -1
          window.scrollTo(0, scrollPosition)
        }
      }

      if (body.style.touchAction === 'none') {
        body.style.touchAction = ''
      }

      if (confirmMobileScroll && !isConversationDetailRef.current) {
        if (!html.style.overflow) {
          html.style.overflowY = 'auto'
        }
        if (!body.style.overflow) {
          body.style.overflowY = 'auto'
        }
      }
    }

    const confirmDocumentScrollUnlock = () => {
      if (isConversationDetailRef.current) {
        return
      }

      unlockDocumentScroll(true)
    }

    const scheduleDocumentScrollUnlockConfirmation = () => {
      cancelScheduledUnlock()

      if (typeof window.requestAnimationFrame === 'function') {
        unlockFrameRef.current = window.requestAnimationFrame(() => {
          unlockFrameRef.current = null
          confirmDocumentScrollUnlock()
        })
      } else {
        confirmDocumentScrollUnlock()
      }

      unlockTimerRef.current = window.setTimeout(() => {
        unlockTimerRef.current = null
        confirmDocumentScrollUnlock()
      }, 160)
    }

    if (!isConversationDetail) {
      blurActiveElement()
      unlockDocumentScroll()
      scheduleDocumentScrollUnlockConfirmation()
      return cancelScheduledUnlock
    }

    cancelScheduledUnlock()

    if (!documentOverflowRef.current) {
      documentOverflowRef.current = {
        html: html.style.overflow,
        body: body.style.overflow,
        htmlY: html.style.overflowY,
        bodyY: body.style.overflowY
      }
    }

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      cancelScheduledUnlock()
      unlockDocumentScroll()
    }
  }, [isConversationDetail])

  return (
    <>
      <div
        className={cn(
          'flex min-h-[calc(100dvh-256px)] w-full max-w-7xl grow px-3 sm:px-6',
          isConversationDetail &&
            'max-lg:min-h-0 max-lg:grow max-lg:overflow-hidden'
        )}
      >
        {children}
      </div>
      {!isConversationDetail && <KunBackToTop />}
      {!isConversationDetail && <KunFooter />}
    </>
  )
}
