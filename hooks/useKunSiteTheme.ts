'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  DEFAULT_KUN_SITE_THEME,
  KUN_SITE_THEME_CHANGE_EVENT,
  KUN_SITE_THEME_STORAGE_KEY,
  resolveKunSiteTheme,
  type KunSiteTheme
} from '~/constants/theme'

const getKunSiteThemeServerSnapshot = () => DEFAULT_KUN_SITE_THEME

const getKunSiteThemeSnapshot = () => {
  if (typeof document === 'undefined') {
    return DEFAULT_KUN_SITE_THEME
  }

  return resolveKunSiteTheme(document.documentElement.dataset.kunTheme)
}

export const setKunSiteTheme = (nextTheme: KunSiteTheme) => {
  if (typeof window === 'undefined') {
    return
  }

  const resolvedTheme = resolveKunSiteTheme(nextTheme)
  document.documentElement.dataset.kunTheme = resolvedTheme

  try {
    window.localStorage.setItem(KUN_SITE_THEME_STORAGE_KEY, resolvedTheme)
  } catch (_) {}

  window.dispatchEvent(
    new CustomEvent<KunSiteTheme>(KUN_SITE_THEME_CHANGE_EVENT, {
      detail: resolvedTheme
    })
  )
}

const subscribeKunSiteTheme = (onStoreChange: () => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleSiteThemeChange = () => {
    onStoreChange()
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== KUN_SITE_THEME_STORAGE_KEY && event.key !== null) {
      return
    }

    const resolvedTheme = resolveKunSiteTheme(event.newValue)
    document.documentElement.dataset.kunTheme = resolvedTheme
    onStoreChange()
  }

  window.addEventListener(KUN_SITE_THEME_CHANGE_EVENT, handleSiteThemeChange)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(
      KUN_SITE_THEME_CHANGE_EVENT,
      handleSiteThemeChange
    )
    window.removeEventListener('storage', handleStorage)
  }
}

export const useKunSiteTheme = () => {
  const theme = useSyncExternalStore(
    subscribeKunSiteTheme,
    getKunSiteThemeSnapshot,
    getKunSiteThemeServerSnapshot
  )

  const setTheme = useCallback((nextTheme: KunSiteTheme) => {
    setKunSiteTheme(nextTheme)
  }, [])

  return { theme, setTheme }
}
