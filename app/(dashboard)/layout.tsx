import type { Metadata, Viewport } from 'next'
import { DashboardProviders } from './providers'
import '~/styles/dashboard.css'

export const metadata: Metadata = {
  title: { default: '管理后台 - OtoAme', template: '%s - OtoAme 管理后台' },
  robots: { index: false, follow: false }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
}

export default function DashboardRoot({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-Hans" suppressHydrationWarning>
      <body>
        <DashboardProviders>{children}</DashboardProviders>
      </body>
    </html>
  )
}
