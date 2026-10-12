import { ResourceLinkEditClient } from '~/components/admin/resource/ResourceLinkEditClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '处理失效链接',
  robots: { index: false, follow: false }
}

export default function AdminResourceLinkEditPage() {
  return <ResourceLinkEditClient />
}
