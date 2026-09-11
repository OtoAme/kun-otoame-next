import { ErrorComponent } from '~/components/error/ErrorComponent'
import { MoemoepointLedgerContainer } from '~/components/moemoepoint/LedgerContainer'
import { kunMetadata } from './metadata'
import { getAdminMoemoepointLedgerAction } from './actions'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

export const revalidate = 0

// 角色校验在 app/admin/layout.tsx (role < 3 → redirect)。
// action 内部还会再校验一次, 因为它是可独立调用的入口。
export default async function AdminUserMoemoepointPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return <ErrorComponent error="用户 ID 不合法" />
  }
  const userId = Number(id)

  const response = await getAdminMoemoepointLedgerAction(userId, {
    range: '30d',
    page: 1,
    limit: 30
  })
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return (
    <MoemoepointLedgerContainer
      userId={userId}
      initialData={response}
      title={`「${response.user.name}」的萌萌点明细`}
      showRulesLink={false}
    />
  )
}
