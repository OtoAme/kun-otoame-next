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
        )
          void refreshPreferences()
      } catch {}
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return null
}
