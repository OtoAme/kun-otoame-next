'use client'

import { AppProgressProvider as ProgressProvider } from '@bprogress/next'
import { HeroUIProvider } from '@heroui/system'
import { ThemeProvider } from 'next-themes'
import { useRouter } from 'next/navigation'
import { SiteThemeRouteSync } from '~/components/kun/theme/SiteThemeRouteSync'
import { MessageRealtimeSync } from '~/components/message/MessageRealtimeSync'

export const Providers = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter()

  return (
    <ProgressProvider
      shallowRouting
      color="hsl(var(--kun-progress-color, var(--heroui-primary)))"
      height="4px"
      options={{ showSpinner: false }}
    >
      <HeroUIProvider navigate={router.push}>
        <ThemeProvider attribute="class">
          <SiteThemeRouteSync />
          <MessageRealtimeSync />
          {children}
        </ThemeProvider>
      </HeroUIProvider>
    </ProgressProvider>
  )
}
