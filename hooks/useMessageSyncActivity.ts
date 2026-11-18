'use client'

import { useEffect, useState } from 'react'

const IDLE_MS = 5 * 60_000

export const useMessageSyncActivity = (privateChat = false) => {
  const [activity, setActivity] = useState({ enabled: false, resumeVersion: 0 })

  useEffect(() => {
    let lastActivityAt = Date.now()
    let initialized = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const update = (resume = false) => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      const visible = document.visibilityState !== 'hidden'
      const online =
        typeof navigator === 'undefined' || navigator.onLine !== false
      const remaining = IDLE_MS - (Date.now() - lastActivityAt)
      const enabled = visible && online && (privateChat || remaining > 0)
      const mayResume = initialized
      initialized = true
      setActivity((current) => {
        if (current.enabled === enabled && !(enabled && resume)) return current
        return {
          enabled,
          resumeVersion:
            current.resumeVersion +
            (mayResume && enabled && (resume || !current.enabled) ? 1 : 0)
        }
      })
      if (!privateChat && remaining > 0)
        idleTimer = setTimeout(() => update(), remaining)
    }
    const onActivity = () => {
      if (Date.now() - lastActivityAt < 1000) return
      lastActivityAt = Date.now()
      update()
    }
    const onResume = () => {
      if (document.visibilityState !== 'hidden') lastActivityAt = Date.now()
      update(true)
    }
    const onNetwork = () => update(true)
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((event) =>
      window.addEventListener(event, onActivity, { passive: true })
    )
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onNetwork)
    window.addEventListener('offline', onNetwork)
    document.addEventListener('visibilitychange', onResume)
    update()
    return () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      events.forEach((event) => window.removeEventListener(event, onActivity))
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [privateChat])

  return activity
}
