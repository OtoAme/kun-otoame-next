import Script from 'next/script'
import { cookies } from 'next/headers'
import { preconnect, prefetchDNS } from 'react-dom'
import { Providers } from './providers'
import { KunTopBar } from '~/components/kun/top-bar/TopBar'
import { KunNavigationBreadcrumb } from '~/components/kun/NavigationBreadcrumb'
import { generateKunMetadata, kunViewport } from './metadata'
import { KunRootRouteChrome } from '~/components/layout/RootRouteChrome'
import { KunToaster } from '~/components/kun/Toaster'
import { SiteThemeScript } from '~/components/kun/theme/SiteThemeScript'
import {
  DEFAULT_KUN_SITE_THEME,
  KUN_SITE_THEME_STORAGE_KEY,
  isKunEnabledSiteTheme
} from '~/constants/theme'
import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata, Viewport } from 'next'
import '~/styles/index.css'
import './actions'

export const viewport: Viewport = kunViewport
export const metadata: Metadata = generateKunMetadata()

export default async function RootLayout({
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
        {process.env.KUN_VISUAL_NOVEL_TEST_SITE_LABEL && (
          <>
            <meta name="robots" content="noindex,nofollow" />
            <meta name="googlebot" content="noindex,nofollow" />
          </>
        )}
      </head>

      <body>
        <Script
          src="https://uma.209911.xyz/script.js"
          data-website-id="e01c3e18-52d6-4057-b1d4-1fa00c45b9ac"
        />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-LZ22SY3YL0"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', 'G-LZ22SY3YL0');
          `}
        </Script>
        <Providers>
          <div className="kun-layout-shell relative min-h-screen bg-radial">
            <div
              className="kun-theme-background pointer-events-none"
              aria-hidden
            />
            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center">
              <KunTopBar />
              <KunNavigationBreadcrumb />
              <KunRootRouteChrome>{children}</KunRootRouteChrome>
            </div>
          </div>
          <KunToaster />
        </Providers>
      </body>
    </html>
  )
}
