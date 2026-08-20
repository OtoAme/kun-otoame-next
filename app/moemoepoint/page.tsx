import { ErrorComponent } from '~/components/error/ErrorComponent'
import { MoemoepointLedgerContainer } from '~/components/moemoepoint/LedgerContainer'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { kunMetadata } from './metadata'
import { getMyMoemoepointLedgerAction } from './actions'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

export const revalidate = 0

export default async function MoemoepointPage() {
  // /moemoepoint 不在 middleware matcher 里, 边缘不鉴权 ——
  // 登录判断必须在这里做。不要把 /moemoepoint/:path* 加进 matcher,
  // 否则公开的 /moemoepoint/rules 也会被踢去 /login。
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return <ErrorComponent error="请登录后查看萌萌点流水" />
  }

  const response = await getMyMoemoepointLedgerAction({
    range: '30d',
    page: 1,
    limit: 30
  })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <MoemoepointLedgerContainer userId={payload.uid} initialData={response} />
  )
}
