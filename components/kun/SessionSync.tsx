'use client'

import { useEffect } from 'react'
import { PreferenceSync } from './PreferenceSync'
import { useUserStore } from '~/store/userStore'
import { refreshUserSession } from '~/utils/sessionClient'

export const SessionSync = () => {
  useEffect(() => {
    void refreshUserSession()
    const onRestore = () => {
      void refreshUserSession({ reason: 'restore' })
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onRestore()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'kun-session-change') return
      useUserStore.getState().invalidateSession()
    }
    const unsubscribe = useUserStore.subscribe((state, previous) => {
      if (state.sessionGeneration !== previous.sessionGeneration) {
        if (state.sessionStatus === 'checking') void refreshUserSession()
      }
    })
    window.addEventListener('storage', onStorage)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onRestore)
    window.addEventListener('popstate', onRestore)
    return () => {
      unsubscribe()
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onRestore)
      window.removeEventListener('popstate', onRestore)
    }
  }, [])

  return <PreferenceSync />
}
