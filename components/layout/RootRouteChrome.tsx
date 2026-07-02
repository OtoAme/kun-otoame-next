'use client'

import { usePathname } from 'next/navigation'
import { KunBackToTop } from '~/components/kun/BackToTop'
import { KunFooter } from '~/components/kun/Footer'
import { isMessageChatConversationPath } from '~/constants/routes/matcher'
import { cn } from '~/utils/cn'

export const KunRootRouteChrome = ({
  children
}: {
  children: React.ReactNode
}) => {
  const pathname = usePathname()
  const isConversationDetail = isMessageChatConversationPath(pathname)

  return (
    <>
      <div
        className={cn(
          'flex min-h-[calc(100dvh-256px)] w-full max-w-7xl grow px-3 sm:px-6',
          isConversationDetail &&
            'max-lg:min-h-0 max-lg:grow-0 max-lg:overflow-hidden'
        )}
      >
        {children}
      </div>
      {!isConversationDetail && <KunBackToTop />}
      {!isConversationDetail && <KunFooter />}
    </>
  )
}
