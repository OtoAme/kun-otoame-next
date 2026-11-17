import { z } from 'zod'
import { compareAndConsumeKv } from '~/lib/redis'
import { prisma } from '~/prisma/index'
import { setControlledEmailNotice } from '~/lib/accountPreferences/service'
import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { disableEmailNoticeSchema } from '~/validations/auth'

const CACHE_KEY = 'auth:mail:notice'

const disableEmailNotice = async (
  input: z.infer<typeof disableEmailNoticeSchema>
) => {
  const consumed = await compareAndConsumeKv(
    `${CACHE_KEY}:${input.email}`,
    input.validateEmailCode
  )
  if (!consumed) {
    return '非法的邮箱验证码, 请您登陆后在用户设置页面取消邮件订阅'
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email }
  })
  if (!user) {
    return '未找到用户'
  }

  try {
    await prisma.$transaction((transaction) =>
      setControlledEmailNotice(transaction, user.id, false)
    )
  } catch {
    return '退订保存失败，此链接已使用；请登录后在用户设置中重新操作'
  }
  return {}
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, disableEmailNoticeSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const res = await disableEmailNotice(input)
  return NextResponse.json(res, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
}
