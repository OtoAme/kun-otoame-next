import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '~/prisma/index'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { randomNormalInt } from '~/utils/random'
import { earnMoemoepoint } from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'

const checkIn = async (uid: number) => {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true }
  })
  if (!user) {
    return '用户未找到'
  }

  const randomMoemoepoints = randomNormalInt(2, 7)

  const result = await prisma.$transaction(async (tx) => {
    const checkedIn = await tx.user.updateMany({
      where: { id: uid, daily_check_in: 0 },
      data: { daily_check_in: { set: 1 } }
    })
    if (checkedIn.count === 0) {
      return null
    }

    return earnMoemoepoint(tx, {
      userId: uid,
      amount: randomMoemoepoints,
      reasonCode: MOEMOEPOINT_REASON.checkIn.code,
      reason: MOEMOEPOINT_REASON.checkIn.text,
      referenceType: 'user',
      referenceId: uid,
      link: '/moemoepoint'
    })
  })
  if (!result) {
    return '您今天已经签到过了'
  }

  return { randomMoemoepoints, balance: result.balance }
}

export async function POST(req: NextRequest) {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const res = await checkIn(payload.uid)
  return NextResponse.json(res)
}
