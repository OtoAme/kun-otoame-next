'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  DEFAULT_KUN_SITE_THEME,
  KUN_SITE_THEME_CHANGE_EVENT,
  KUN_SITE_THEME_STORAGE_KEY,
  isKunEnabledSiteTheme,
  readKunSiteThemeCookie,
  resolveKunSiteTheme,
  serializeKunSiteThemeCookie,
  type KunSiteTheme
} from '~/constants/theme'

const getKunSiteThemeServerSnapshot = () => DEFAULT_KUN_SITE_THEME

const getStoredKunSiteTheme = () => {
  try {
    const cookieTheme = readKunSiteThemeCookie(document.cookie)
    if (cookieTheme) {
      return cookieTheme
    }
  } catch (_) {}

  try {
    return resolveKunSiteTheme(
      window.localStorage.getItem(KUN_SITE_THEME_STORAGE_KEY)
    )
  } catch (_) {
    return DEFAULT_KUN_SITE_THEME
  }
}

const getKunSiteThemeSnapshot = () => {
  if (typeof document === 'undefined') {
    return DEFAULT_KUN_SITE_THEME
  }

  const root = document.documentElement
  const datasetTheme = resolveKunSiteTheme(root.dataset.kunTheme)

  if (root.dataset.kunThemeSource === 'server') {
    return datasetTheme
  }

  if (datasetTheme !== DEFAULT_KUN_SITE_THEME) {
    return datasetTheme
  }

  return getStoredKunSiteTheme()
}

const writeKunSiteThemeCookie = (theme: KunSiteTheme) => {
  try {
    document.cookie = serializeKunSiteThemeCookie(
      theme,
      window.location.protocol === 'https:'
    )
  } catch (_) {}
}

export const setKunSiteTheme = (nextTheme: KunSiteTheme) => {
  if (typeof window === 'undefined') {
    return
  }

  const resolvedTheme = resolveKunSiteTheme(nextTheme)
  document.documentElement.dataset.kunTheme = resolvedTheme
  document.documentElement.dataset.kunThemeSource = 'client'

  try {
    window.localStorage.setItem(KUN_SITE_THEME_STORAGE_KEY, resolvedTheme)
  } catch (_) {}
  writeKunSiteThemeCookie(resolvedTheme)

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

    const nextTheme =
      event.newValue !== null && isKunEnabledSiteTheme(event.newValue)
        ? event.newValue
        : getStoredKunSiteTheme()
    document.documentElement.dataset.kunTheme = nextTheme
    document.documentElement.dataset.kunThemeSource = 'client'
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
