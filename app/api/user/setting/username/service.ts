import { prisma } from '~/prisma/index'
import { updateKunSessions } from '~/app/api/utils/jwt'
import {
  MoemoepointInsufficientError,
  spendMoemoepoint
} from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import { toMoemoepointBalance } from '~/utils/moemoepoint'

export const updateUsername = async (username: string, uid: number) => {
  const user = await prisma.user.findUnique({ where: { id: uid } })
  if (!user) {
    return '用户未找到'
  }
  if (username === user.name.trim()) {
    return { balance: toMoemoepointBalance(user) }
  }
  if (toMoemoepointBalance(user).available < 30) {
    return '更改用户名需要 30 可用萌萌点，您的可用萌萌点不足'
  }

  const sameUsernameUser = await prisma.user.findFirst({
    where: { name: { equals: username.toLowerCase(), mode: 'insensitive' } }
  })
  if (sameUsernameUser) {
    if (
      sameUsernameUser.id === uid &&
      sameUsernameUser.name.trim() === username
    ) {
      return { balance: toMoemoepointBalance(sameUsernameUser) }
    }
    return '您的用户名已经有人注册了, 请修改'
  }

  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      // Claim the change before charging so concurrent identical submissions pay once.
      const changed = await tx.user.updateMany({
        where: { id: uid, name: { not: username } },
        data: { name: username }
      })
      if (!changed.count) {
        const currentUser = await tx.user.findUniqueOrThrow({
          where: { id: uid },
          select: { moemoepoint: true, moemoepoint_reserved: true }
        })
        return { changed: false, balance: toMoemoepointBalance(currentUser) }
      }

      const change = await spendMoemoepoint(tx, {
        userId: uid,
        amount: 30,
        reasonCode: MOEMOEPOINT_REASON.usernameChanged.code,
        reason: MOEMOEPOINT_REASON.usernameChanged.text,
        referenceType: 'user',
        referenceId: uid,
        link: '/settings/user'
      })
      return { changed: true, balance: change.balance }
    })
  } catch (error) {
    if (error instanceof MoemoepointInsufficientError) {
      return '更改用户名需要 30 可用萌萌点，您的可用萌萌点不足'
    }
    throw error
  }

  if (result.changed) {
    await updateKunSessions(uid, { name: username })
  }
  return { balance: result.balance }
}
