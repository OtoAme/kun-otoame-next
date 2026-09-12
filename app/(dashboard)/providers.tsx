'use client'

import { ThemeProvider } from 'next-themes'
import { AppProgressProvider } from '@bprogress/next'
import { Toaster } from 'react-hot-toast'
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
        <ShoutboxQueryProvider>{children}</ShoutboxQueryProvider>
        <Toaster position="top-center" />
      </AppProgressProvider>
    </ThemeProvider>
  )
}
