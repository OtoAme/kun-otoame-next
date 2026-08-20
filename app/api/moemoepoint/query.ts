import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { toMoemoepointBalance } from '~/utils/moemoepoint'
import { resolveMoemoepointDateRange } from '~/utils/moemoepointDateRange'
import { moemoepointLedgerQuerySchema } from '~/validations/moemoepoint'
import type {
  MoemoepointLedgerKind,
  MoemoepointLedgerResponse
} from '~/types/api/moemoepoint'

export const getMoemoepointLedger = async (
  userId: number,
  input: z.infer<typeof moemoepointLedgerQuerySchema>,
  now = new Date()
): Promise<MoemoepointLedgerResponse | string> => {
  // 先确认用户存在, 再跑流水查询。否则用户不存在时会白跑一次 findMany 和一次 count。
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      avatar: true,
      moemoepoint: true,
      moemoepoint_reserved: true
    }
  })
  if (!user) {
    return '未找到用户'
  }

  const range = resolveMoemoepointDateRange(input, now)
  const offset = (input.page - 1) * input.limit
  const where = {
    user_id: userId,
    created: { gte: range.startAt, lt: range.endAtExclusive }
  }

  const [records, total] = await Promise.all([
    prisma.user_moemoepoint_ledger.findMany({
      where,
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: input.limit
    }),
    prisma.user_moemoepoint_ledger.count({ where })
  ])

  return {
    user: { id: user.id, name: user.name, avatar: user.avatar },
    balance: toMoemoepointBalance(user),
    records: records.map((record) => ({
      id: record.id,
      kind: record.kind as MoemoepointLedgerKind,
      balanceDelta: record.balance_delta,
      reservedDelta: record.reserved_delta,
      availableDelta: record.balance_delta - record.reserved_delta,
      balanceAfter: {
        total: record.balance_after,
        reserved: record.reserved_after,
        available: record.balance_after - record.reserved_after
      },
      reasonCode: record.reason_code,
      reason: record.reason,
      referenceType: record.reference_type,
      referenceId: record.reference_id,
      link: record.link,
      created: record.created.toISOString()
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.limit))
    },
    range: { preset: range.preset, start: range.start, end: range.end }
  }
}
