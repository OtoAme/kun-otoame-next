import { MessageLayoutChrome } from '~/components/message/MessageLayoutChrome'
import { kunMetadata } from './metadata'
import { Suspense } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

export default function MessageLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense>
      <MessageLayoutChrome>{children}</MessageLayoutChrome>
    </Suspense>
  )
}
