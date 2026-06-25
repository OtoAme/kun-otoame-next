'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { syncKunSiteThemeFromStorage } from '~/hooks/useKunSiteTheme'

export const SiteThemeRouteSync = () => {
  const pathname = usePathname()

  useEffect(() => {
    syncKunSiteThemeFromStorage()
  }, [pathname])

  return null
}
