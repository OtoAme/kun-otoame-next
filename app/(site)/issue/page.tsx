import { CaseTabsContainer } from '~/components/case/CaseTabsContainer'
import { IssueLoginRequired } from '~/components/case/IssueLoginRequired'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { kunMetadata } from './metadata'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

export const revalidate = 0

export default async function IssuePage() {
  // /issue 由 middleware 鉴权, 这里再兜底一次, 未登录时给出登录引导而不是报错。
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return (
      <IssueLoginRequired
        title="问题处理"
        description="登录后才能查看和跟进自己提交的问题。还没有账号的话，可以先注册。"
        showRegister
      />
    )
  }

  return <CaseTabsContainer />
}
