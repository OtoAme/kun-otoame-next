'use client'

import { useCallback, useEffect, useState } from 'react'
import { getInternalNavigationHref } from '~/utils/leaveGuard'

// Guards work that only lives in memory. `beforeunload` covers reload, tab
// close and hard navigation; the capture-phase click listener covers in-app
// links so the caller can confirm first. Browser back/forward is not guarded:
// popstate cannot be cancelled, and re-pushing history entries to fake it
// fights the App Router.
export const useLeaveConfirm = (enabled: boolean) => {
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Browsers show their own wording; assigning returnValue is what still
      // triggers the prompt in older engines.
      event.returnValue = ''
    }

    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const eventTarget = event.target
      if (!(eventTarget instanceof Element)) {
        return
      }

      const anchor = eventTarget.closest('a')
      if (!anchor) {
        return
      }

      const href = getInternalNavigationHref(
        {
          href: anchor.href,
          target: anchor.getAttribute('target'),
          hasDownload: anchor.hasAttribute('download')
        },
        window.location.href
      )
      if (!href) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setPendingHref(href)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleClick, true)
    }
  }, [enabled])

  const cancelNavigation = useCallback(() => setPendingHref(null), [])

  return { pendingHref, cancelNavigation }
}
