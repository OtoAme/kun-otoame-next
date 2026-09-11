import { Sidebar } from '~/components/admin/Sidebar'
// import { Navbar } from '~/components/admin/Navbar'
import { kunMetadata } from './metadata'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { canAccessAdmin } from '~/constants/user'
import Link from 'next/link'

export const metadata: Metadata = kunMetadata

interface Props {
  children: React.ReactNode
}

export default async function Kun({ children }: Props) {
  const payload = await verifyHeaderCookie()
  if (!payload || !canAccessAdmin(payload.role)) {
    redirect('/')
  }

  return (
    <div className="container flex mx-auto my-4">
      <Sidebar />
      <div className="flex w-full overflow-y-auto">
        {/* <Navbar /> */}
        <div className="w-full p-4">
          <Link
            href="/dashboard"
            className="mb-4 inline-block text-sm text-primary underline"
          >
            返回新后台
          </Link>
          {children}
        </div>
      </div>
    </div>
  )
}
