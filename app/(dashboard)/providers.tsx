'use client'

import { ThemeProvider } from 'next-themes'
import { AppProgressProvider } from '@bprogress/next'
import { Toaster } from 'react-hot-toast'
import { SessionSync } from '~/components/kun/SessionSync'
import { SessionContentBoundary } from '~/components/kun/SessionContentBoundary'
import { ShoutboxQueryProvider } from '~/components/shoutbox/query/ShoutboxQueryProvider'
import { SessionRenderProvider } from '~/components/kun/SessionRenderProvider'
import type { SessionRenderState } from '~/types/api/session'

export function DashboardProviders({
  children,
  initialSession
}: {
  children: React.ReactNode
  initialSession: SessionRenderState | null
}) {
  return (
    <SessionRenderProvider initialState={initialSession}>
      <ThemeProvider attribute="class">
        <AppProgressProvider
          color="var(--primary)"
          height="3px"
          options={{ showSpinner: false }}
        >
          <SessionSync />
          <SessionContentBoundary usesBrowsingPreferences={false}>
            <ShoutboxQueryProvider>{children}</ShoutboxQueryProvider>
          </SessionContentBoundary>
          <Toaster position="top-center" />
        </AppProgressProvider>
      </ThemeProvider>
    </SessionRenderProvider>
  )
}
