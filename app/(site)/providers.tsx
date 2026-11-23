'use client'

import { AppProgressProvider as ProgressProvider } from '@bprogress/next'
import { ToastProvider } from '@heroui/react'
import { HeroUIProvider } from '@heroui/system'
import { ThemeProvider } from 'next-themes'
import { useRouter } from 'next/navigation'
import { SiteThemeRouteSync } from '~/components/kun/theme/SiteThemeRouteSync'
import { MessageRealtimeSync } from '~/components/message/MessageRealtimeSync'
import { SessionSync } from '~/components/kun/SessionSync'
import { ShoutboxQueryProvider } from '~/components/shoutbox/query/ShoutboxQueryProvider'
import { SessionRenderProvider } from '~/components/kun/SessionRenderProvider'
import type { SessionRenderState } from '~/types/api/session'

export const Providers = ({
  children,
  initialSession
}: {
  children: React.ReactNode
  initialSession: SessionRenderState | null
}) => {
  const router = useRouter()

  return (
    <SessionRenderProvider initialState={initialSession}>
      <ProgressProvider
        shallowRouting
        color="hsl(var(--kun-progress-color, var(--heroui-primary)))"
        height="4px"
        options={{ showSpinner: false }}
      >
        <HeroUIProvider navigate={router.push}>
          <ThemeProvider attribute="class">
            <ToastProvider placement="top-center" maxVisibleToasts={4} />
            <SiteThemeRouteSync />
            <MessageRealtimeSync />
            <SessionSync />
            <ShoutboxQueryProvider>{children}</ShoutboxQueryProvider>
          </ThemeProvider>
        </HeroUIProvider>
      </ProgressProvider>
    </SessionRenderProvider>
  )
}
