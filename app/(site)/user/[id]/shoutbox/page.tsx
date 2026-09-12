import { Suspense } from 'react'
import { getUserShoutboxes } from '~/app/api/shoutbox/service'
import { ErrorComponent } from '~/components/error/ErrorComponent'
import { UserShoutboxContainer } from '~/components/shoutbox/UserShoutboxContainer'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { shoutboxProfileSchema } from '~/validations/shoutbox'

export const revalidate = 0

interface Props {
  params: Promise<{ id: string }>
}

export default async function UserShoutboxPage({ params }: Props) {
  const { id } = await params
  const input = safeParseSchema(shoutboxProfileSchema, {
    uid: Number(id),
    page: 1,
    limit: 6
  })
  if (typeof input === 'string') {
    return <ErrorComponent error={input} />
  }

  // /user/:path* requires a verified session at the middleware layer; keep
  // the page coherent with that instead of querying as an anonymous viewer.
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return <ErrorComponent error="用户登录失效" />
  }
  const visibilityWhere = await getPatchVisibilityWhere()
  try {
    const response = await getUserShoutboxes(
      input,
      { uid: payload.uid, role: payload.role },
      { visibilityWhere }
    )
    return (
      <Suspense>
        <UserShoutboxContainer uid={input.uid} initialData={response} />
      </Suspense>
    )
  } catch {
    return <ErrorComponent error="获取小喇叭失败，请稍后重试" />
  }
}
