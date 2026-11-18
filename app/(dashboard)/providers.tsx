'use client'

import { ThemeProvider } from 'next-themes'
import { AppProgressProvider } from '@bprogress/next'
import { Toaster } from 'react-hot-toast'
import { SessionSync } from '~/components/kun/SessionSync'
import { SessionContentBoundary } from '~/components/kun/SessionContentBoundary'
import { ShoutboxQueryProvider } from '~/components/shoutbox/query/ShoutboxQueryProvider'

export function DashboardProviders({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <ThemeProvider attribute="class">
      <AppProgressProvider
        color="var(--primary)"
        height="3px"
        options={{ showSpinner: false }}
      >
        <SessionSync />
        <SessionContentBoundary>
          <ShoutboxQueryProvider>{children}</ShoutboxQueryProvider>
        </SessionContentBoundary>
        <Toaster position="top-center" />
      </AppProgressProvider>
    </ThemeProvider>
  )
}
