import { ErrorComponent } from '~/components/error/ErrorComponent'
import { MoemoepointLedgerContainer } from '~/components/user/moemoepoint/LedgerContainer'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getMoemoepointLedgerAction } from './actions'

export const revalidate = 0

export default async function MoemoepointLedgerPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return <ErrorComponent error="用户 ID 不合法" />
  }
  const userId = Number(id)
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return <ErrorComponent error="请登录后查看萌萌点流水" />
  }
  if (payload.uid !== userId && payload.role < 3) {
    return <ErrorComponent error="您没有权限查看该用户的萌萌点流水" />
  }

  const response = await getMoemoepointLedgerAction(userId, {
    range: '30d',
    page: 1,
    limit: 30
  })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return <MoemoepointLedgerContainer userId={userId} initialData={response} />
}
