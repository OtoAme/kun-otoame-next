'use client'

import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useUserStore } from '~/store/userStore'
import {
  isNotificationBodyVisible,
  observeNotificationReading
} from '~/utils/notificationVisibility'
import {
  confirmNotificationItems,
  isCurrentNotificationIdentity,
  NOTIFICATION_ENTRY_PARAMETER,
  resolveNotificationEntry
} from '~/utils/notificationReading'

interface Props {
  path?: string
  enabled?: boolean
}

const TargetReady = ({ path, enabled = true }: Props) => {
  const marker = useRef<HTMLSpanElement>(null)
  const pathname = usePathname()
  const parameters = useSearchParams()
  const token = parameters.get(NOTIFICATION_ENTRY_PARAMETER)
  const session = useUserStore()
  useEffect(() => {
    if (
      !enabled ||
      (path && window.location.pathname !== path) ||
      !token ||
      session.sessionStatus !== 'authenticated' ||
      !session.sessionContext
    )
      return
    const identity = {
      uid: session.user.uid,
      context: session.sessionContext,
      generation: session.sessionGeneration
    }
    let cancelled = false
    let stopReading: (() => void) | undefined
    let observed: HTMLElement | null = null
    let complete = false
    let activity = 0
    const current = window.location.href
    const findTarget = () => {
      if (
        cancelled ||
        complete ||
        !isCurrentNotificationIdentity(identity) ||
        window.location.href !== current
      )
        return
      const hash = window.location.hash.slice(1)
      const comment = parameters.get('commentId')
      const shoutbox = parameters.get('shoutbox')
      const link = parameters.get('linkId')
      let anchor = hash
      try {
        anchor = decodeURIComponent(hash)
      } catch {
        return
      }
      const target = hash
        ? document.getElementById(anchor)
        : comment
          ? document.getElementById(`comment-${comment}`)
          : shoutbox
            ? document.getElementById(`shoutbox-${shoutbox}`)
            : link
              ? document.getElementById(`workspace-link-${link}`)
              : marker.current?.parentElement
      if (!target || target === observed) return
      observed = target
      stopReading?.()
      stopReading = observeNotificationReading(target, () => {
        if (
          cancelled ||
          !isCurrentNotificationIdentity(identity) ||
          window.location.href !== current
        )
          return
        complete = true
        const qualifiedAt = activity
        void resolveNotificationEntry(identity, token, current)
          .then(async (entry) => {
            if (
              !entry ||
              cancelled ||
              !isCurrentNotificationIdentity(identity) ||
              window.location.href !== current
            )
              return
            if (
              activity !== qualifiedAt ||
              !isNotificationBodyVisible(target)
            ) {
              complete = false
              observed = null
              findTarget()
              return
            }
            await confirmNotificationItems(identity, [entry.item], entry.target)
          })
          .catch(() => {
            complete = false
            observed = null
            findTarget()
          })
      })
    }
    const invalidate = () => {
      activity++
    }
    const events = ['blur', 'focus', 'resize', 'scroll'] as const
    events.forEach((event) => window.addEventListener(event, invalidate, true))
    document.addEventListener('visibilitychange', invalidate)
    const changes = new MutationObserver(() => {
      if (complete) activity++
      findTarget()
    })
    changes.observe(document.body, { childList: true, subtree: true })
    findTarget()
    return () => {
      cancelled = true
      changes.disconnect()
      stopReading?.()
      events.forEach((event) =>
        window.removeEventListener(event, invalidate, true)
      )
      document.removeEventListener('visibilitychange', invalidate)
    }
  }, [
    token,
    pathname,
    parameters,
    path,
    enabled,
    session.sessionStatus,
    session.user.uid,
    session.sessionContext,
    session.sessionGeneration
  ])
  return <span ref={marker} hidden data-notification-target-ready="" />
}

export const NotificationTargetReady = (props: Props) => (
  <Suspense fallback={null}>
    <TargetReady {...props} />
  </Suspense>
)
