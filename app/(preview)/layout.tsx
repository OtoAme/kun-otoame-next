import { cookies } from 'next/headers'
import { preconnect, prefetchDNS } from 'react-dom'
import { PreviewProviders } from './providers'
import { SiteThemeScript } from '~/components/kun/theme/SiteThemeScript'
import {
  DEFAULT_KUN_SITE_THEME,
  KUN_SITE_THEME_STORAGE_KEY,
  isKunEnabledSiteTheme
} from '~/constants/theme'
import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata, Viewport } from 'next'
import '~/styles/index.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' }
  ],
  colorScheme: 'light dark'
}

export const metadata: Metadata = {
  title: '管理员预览',
  robots: { index: false, follow: false }
}

/**
 * Same-origin admin preview document: site styles and theme for the public
 * card, without site chrome, shoutbox, analytics, or realtime sessions.
 * The size marker is what dashboard PreviewFrame measures.
 */
export default async function PreviewRoot({
  children
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const rawSiteTheme = cookieStore.get(KUN_SITE_THEME_STORAGE_KEY)?.value
  const hasServerTheme = isKunEnabledSiteTheme(rawSiteTheme)
  const siteTheme = hasServerTheme ? rawSiteTheme : DEFAULT_KUN_SITE_THEME

  preconnect(kunMoyuMoe.domain.imageBed)
  prefetchDNS(kunMoyuMoe.domain.imageBed)

  return (
    <html
      lang="zh-Hans"
      data-kun-theme={siteTheme}
      data-kun-theme-source={hasServerTheme ? 'server' : undefined}
      suppressHydrationWarning
    >
      <head>
        <SiteThemeScript />
      </head>
      <body>
        <PreviewProviders>
          <div className="kun-layout-shell relative bg-radial">
            <div
              className="kun-theme-background pointer-events-none"
              aria-hidden
            />
            <div className="relative z-10 mx-auto w-full max-w-7xl">
              <div
                data-admin-preview-content
                className="flow-root px-3 py-4 sm:px-6"
              >
                {children}
              </div>
            </div>
          </div>
        </PreviewProviders>
      </body>
    </html>
  )
}
