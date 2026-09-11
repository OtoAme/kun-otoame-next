import { ErrorComponent } from '~/components/error/ErrorComponent'
import { MoemoepointLedgerContainer } from '~/components/moemoepoint/LedgerContainer'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { Link } from '@heroui/link'
import { kunMetadata } from './metadata'
import { getMyMoemoepointLedgerAction } from './actions'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

export const revalidate = 0

const LoginRequired = () => (
  <div className="container mx-auto my-8">
    <Card className="mx-auto max-w-lg">
      <CardBody className="items-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-medium">萌萌点明细</h1>
        <p className="text-default-500">
          登录后才能查看自己的萌萌点明细。还没有账号的话，可以先注册。
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button as={Link} href="/login" color="primary">
            登录
          </Button>
          <Button as={Link} href="/register" variant="bordered">
            注册账号
          </Button>
        </div>
      </CardBody>
    </Card>
  </div>
)

export default async function MoemoepointPage() {
  // /moemoepoint 不在 middleware matcher 里, 边缘不鉴权 ——
  // 登录判断必须在这里做。不要把 /moemoepoint/:path* 加进 matcher,
  // 否则公开的 /moemoepoint/rules 也会被踢去 /login。
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return <LoginRequired />
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
