'use client'

import { AppProgressProvider as ProgressProvider } from '@bprogress/next'
import { HeroUIProvider } from '@heroui/system'
import { ThemeProvider } from 'next-themes'
import { useRouter } from 'next/navigation'

/**
 * HeroUI and site theme for the public card, plus the progress router the
 * card's publisher control uses. No toasts, shoutbox, or realtime messages.
 */
export const PreviewProviders = ({
  children
}: {
  children: React.ReactNode
}) => {
  const router = useRouter()

  return (
    <ProgressProvider
      shallowRouting
      color="hsl(var(--kun-progress-color, var(--heroui-primary)))"
      height="4px"
      options={{ showSpinner: false }}
    >
      <HeroUIProvider navigate={router.push}>
        <ThemeProvider attribute="class">{children}</ThemeProvider>
      </HeroUIProvider>
    </ProgressProvider>
  )
}
