'use client'

import { ThemeProvider } from 'next-themes'
import { AppProgressProvider } from '@bprogress/next'
import { Toaster } from 'react-hot-toast'

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
        {children}
        <Toaster position="top-center" />
      </AppProgressProvider>
    </ThemeProvider>
  )
}
