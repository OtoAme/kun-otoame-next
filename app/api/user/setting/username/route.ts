import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { updateKunSessions } from '~/app/api/utils/jwt'
import { prisma } from '~/prisma/index'
import { usernameSchema } from '~/validations/user'
import {
  MoemoepointInsufficientError,
  spendMoemoepoint
} from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import { toMoemoepointBalance } from '~/utils/moemoepoint'

const updateUsername = async (username: string, uid: number) => {
  const user = await prisma.user.findUnique({ where: { id: uid } })
  if (!user) {
    return '用户未找到'
  }
  if (toMoemoepointBalance(user).available < 30) {
    return '更改用户名需要 30 可用萌萌点，您的可用萌萌点不足'
  }

  const normalizedName = username.toLowerCase()
  const sameUsernameUser = await prisma.user.findFirst({
    where: { name: { equals: normalizedName, mode: 'insensitive' } }
  })
  if (sameUsernameUser) {
    return '您的用户名已经有人注册了, 请修改'
  }

  let balance
  try {
    balance = await prisma.$transaction(async (tx) => {
      const change = await spendMoemoepoint(tx, {
        userId: uid,
        amount: 30,
        reasonCode: MOEMOEPOINT_REASON.usernameChanged.code,
        reason: MOEMOEPOINT_REASON.usernameChanged.text,
        referenceType: 'user',
        referenceId: uid,
        link: '/settings/user'
      })
      await tx.user.update({ where: { id: uid }, data: { name: username } })
      return change.balance
    })
  } catch (error) {
    if (error instanceof MoemoepointInsufficientError) {
      return '更改用户名需要 30 可用萌萌点，您的可用萌萌点不足'
    }
    throw error
  }
  await updateKunSessions(uid, { name: username })
  return { balance }
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, usernameSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const res = await updateUsername(input.username, payload.uid)
  if (typeof res === 'string') {
    return NextResponse.json(res)
  }

  return NextResponse.json(res)
}
