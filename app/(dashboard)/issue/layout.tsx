import { IssueHeader } from '~/components/dashboard/issue/IssueHeader'
import { IssueLoginNotice } from '~/components/dashboard/issue/IssueLoginNotice'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  // 用户侧页面，虽然挂在 (dashboard) 根下取 shadcn 样式，但不套父级
  // 「%s - OtoAme 管理后台」标题模板；noindex 保留，这是登录后才可见的私有页。
  title: { absolute: '问题处理' },
  robots: { index: false, follow: false, nocache: true, noimageindex: true }
}

export const revalidate = 0

/**
 * 用户侧「问题处理」的独立外壳：自有顶栏 + 居中内容区，不套后台的
 * DashboardShell（那是管理员侧栏）。与 /dashboard 的另一处不同是只要求登录，
 * 不要求 role ≥ 3。
 */
export default async function IssueLayout({
  children
}: {
  children: React.ReactNode
}) {
  // /issue 由 middleware 按 URL 鉴权, 这里再兜底一次, 未登录时给出登录引导而不是报错。
  const payload = await verifyHeaderCookie()

  return (
    <div className="min-h-dvh bg-muted/40">
      <IssueHeader
        user={payload ? { id: payload.uid, name: payload.name } : null}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        {payload ? children : <IssueLoginNotice />}
      </main>
    </div>
  )
}
