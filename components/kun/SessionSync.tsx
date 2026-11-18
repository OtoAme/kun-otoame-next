'use client'

import { useEffect } from 'react'
import { PreferenceSync } from './PreferenceSync'
import { useUserStore } from '~/store/userStore'
import { refreshUserSession } from '~/utils/sessionClient'

export const SessionSync = () => {
  useEffect(() => {
    void refreshUserSession()
    const onRestore = () => {
      void refreshUserSession()
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
    const onVisible = () => {
      if (document.visibilityState === 'visible') onRestore()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('storage', onStorage)
    window.addEventListener('pageshow', onRestore)
    window.addEventListener('online', onRestore)
    window.addEventListener('popstate', onRestore)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pageshow', onRestore)
      window.removeEventListener('online', onRestore)
      window.removeEventListener('popstate', onRestore)
    }
  }, [])

  return <PreferenceSync />
}
