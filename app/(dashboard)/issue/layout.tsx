import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: '问题处理' },
  robots: { index: false, follow: false, nocache: true, noimageindex: true }
}

export const revalidate = 0

/**
 * Compatibility shell. Login and the workspace chrome live under /workspace;
 * these pages only redirect and must not mount DashboardShell or site counts.
 */
export default function IssueLayout({
  children
}: {
  children: React.ReactNode
}) {
  return children
}
