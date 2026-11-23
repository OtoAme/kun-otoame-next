'use client'
import { useEffect } from 'react'
import Cookies from 'js-cookie'
import { useUserStore } from '~/store/userStore'
import { usePreferenceStore } from '~/store/preferenceStore'
import { refreshPreferences } from '~/utils/preferenceClient'

export const PreferenceSync = () => {
  const { sessionStatus, sessionContext, sessionGeneration, user } =
    useUserStore()
  useEffect(() => {
    if (sessionStatus === 'guest') {
      usePreferenceStore.setState({
        applied: null,
        generation: null,
        drafts: {},
        conflicts: [],
        observedVersion: null,
        legacyNsfw: null,
        status: 'idle',
        saving: false,
        error: null
      })
      for (const key of Object.keys(Cookies.get()))
        if (key.startsWith('kun-patch-setting-store'))
          Cookies.remove(key, { path: '/' })
      return
    }
    if (sessionStatus !== 'authenticated' || !sessionContext) return
    const state = usePreferenceStore.getState()
    if (
      state.generation !== sessionGeneration ||
      state.applied?.context !== sessionContext
    )
      void refreshPreferences()
  }, [sessionStatus, sessionContext, sessionGeneration, user.uid])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'kun-preference-change' || !event.newValue) return
      try {
        const hint = JSON.parse(event.newValue)
        const session = useUserStore.getState()
        const applied = usePreferenceStore.getState().applied
        if (
          session.sessionStatus === 'authenticated' &&
          hint.uid === session.user.uid &&
          Number.isInteger(hint.version) &&
          (!applied || hint.version > applied.version)
        ) {
          usePreferenceStore.setState((state) => ({
            observedVersion: Math.max(state.observedVersion ?? 0, hint.version)
          }))
          if (document.visibilityState !== 'hidden') void refreshPreferences()
        }
      } catch {
        // Ignore malformed storage notifications and read the server on restore.
      }
    }
    window.addEventListener('storage', onStorage)
    const onRestore = () => {
      if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
        void refreshPreferences([], { reason: 'restore' })
      }
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onRestore()
    }
    window.addEventListener('focus', onRestore)
    window.addEventListener('online', onRestore)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onRestore)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onRestore)
      window.removeEventListener('online', onRestore)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onRestore)
    }
  }, [])
  return null
}
