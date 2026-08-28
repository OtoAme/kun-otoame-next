import { Prisma } from '@prisma/client'
import type {
  MoemoepointBalance,
  MoemoepointLedgerKind,
  MoemoepointReservationStatus
} from '~/types/api/moemoepoint'

type Tx = Prisma.TransactionClient

type BalanceRow = {
  moemoepoint: number
  moemoepoint_reserved: number
}

type ChangeMetadata = {
  reasonCode: string
  reason: string
  referenceType?: string
  referenceId?: string | number
  link?: string
  operatorId?: number
  idempotencyKey?: string
}

type ApplyChangeInput = ChangeMetadata & {
  userId: number
  kind: MoemoepointLedgerKind
  balanceDelta: number
  reservedDelta?: number
  reservationId?: number
  requiredAvailable?: number
}

type AmountChangeInput = ChangeMetadata & {
  userId: number
  amount: number
}

export type MoemoepointChangeResult = {
  balance: MoemoepointBalance
  ledgerId: number
  applied: boolean
}

const toBalance = (row: BalanceRow): MoemoepointBalance => ({
  total: row.moemoepoint,
  reserved: row.moemoepoint_reserved,
  available: row.moemoepoint - row.moemoepoint_reserved
})

// user_moemoepoint_ledger.reason 是 VarChar(500)。原因文本经常拼接用户内容
// (游戏名 VarChar(1007)、资源名 VarChar(300)), 长度不可控。这里截断而不是拒绝:
// 明细是业务写入的副产品, 不能因为标题太长就让发布游戏整个事务回滚。
const MAX_REASON_LENGTH = 500

export const normalizeMoemoepointReason = (reason: string) =>
  reason.trim().slice(0, MAX_REASON_LENGTH)

const assertPositiveAmount = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MoemoepointInvalidChangeError('萌萌点变更数量必须为正整数')
  }
}

const assertMetadata = (input: ChangeMetadata) => {
  if (!input.reasonCode.trim() || input.reasonCode.length > 64) {
    throw new MoemoepointInvalidChangeError('萌萌点原因代码不合法')
  }
  if (!input.reason.trim()) {
    throw new MoemoepointInvalidChangeError('萌萌点变更原因不合法')
  }
  if (input.link && input.link.length > 1000) {
    throw new MoemoepointInvalidChangeError('萌萌点关联链接过长')
  }
  if (input.referenceType && input.referenceType.length > 64) {
    throw new MoemoepointInvalidChangeError('萌萌点关联类型过长')
  }
  if (
    input.referenceId !== undefined &&
    String(input.referenceId).length > 191
  ) {
    throw new MoemoepointInvalidChangeError('萌萌点关联 ID 过长')
  }
  if (input.idempotencyKey && input.idempotencyKey.length > 191) {
    throw new MoemoepointInvalidChangeError('萌萌点幂等键过长')
  }
}

export class MoemoepointInsufficientError extends Error {
  constructor() {
    super('可用萌萌点不足')
    this.name = 'MoemoepointInsufficientError'
  }
}

export class MoemoepointUserNotFoundError extends Error {
  constructor() {
    super('用户未找到')
    this.name = 'MoemoepointUserNotFoundError'
  }
}

export class MoemoepointInvalidChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoemoepointInvalidChangeError'
  }
}

export class MoemoepointReservationNotFoundError extends Error {
  constructor() {
    super('萌萌点暂扣记录不存在')
    this.name = 'MoemoepointReservationNotFoundError'
  }
}

export class MoemoepointReservationSettledError extends Error {
  constructor() {
    super('萌萌点暂扣记录已经结算')
    this.name = 'MoemoepointReservationSettledError'
  }
}

export const getCurrentBalance = async (tx: Tx, userId: number) => {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { moemoepoint: true, moemoepoint_reserved: true }
  })
  if (!user) {
    throw new MoemoepointUserNotFoundError()
  }
  return toBalance(user)
}

export const applyMoemoepointChange = async (
  tx: Tx,
  input: ApplyChangeInput
): Promise<MoemoepointChangeResult> => {
  assertMetadata(input)
  const reservedDelta = input.reservedDelta ?? 0
  if (
    !Number.isSafeInteger(input.balanceDelta) ||
    !Number.isSafeInteger(reservedDelta) ||
    (input.requiredAvailable !== undefined &&
      (!Number.isSafeInteger(input.requiredAvailable) ||
        input.requiredAvailable < 0))
  ) {
    throw new MoemoepointInvalidChangeError('萌萌点变更值不合法')
  }

  if (input.idempotencyKey) {
    const existing = await tx.user_moemoepoint_ledger.findUnique({
      where: { idempotency_key: input.idempotencyKey },
      select: { id: true, user_id: true }
    })
    if (existing) {
      if (existing.user_id !== input.userId) {
        throw new MoemoepointInvalidChangeError('萌萌点幂等键已被占用')
      }
      return {
        balance: await getCurrentBalance(tx, input.userId),
        ledgerId: existing.id,
        applied: false
      }
    }
  }

  const availableGuard =
    input.requiredAvailable === undefined
      ? Prisma.empty
      : Prisma.sql`AND (moemoepoint - moemoepoint_reserved) >= ${input.requiredAvailable}`

  const rows = await tx.$queryRaw<BalanceRow[]>(Prisma.sql`
    UPDATE "user"
    SET
      moemoepoint = moemoepoint + ${input.balanceDelta},
      moemoepoint_reserved = moemoepoint_reserved + ${reservedDelta},
      updated = CURRENT_TIMESTAMP
    WHERE id = ${input.userId}
      AND (moemoepoint_reserved + ${reservedDelta}) >= 0
      ${availableGuard}
    RETURNING moemoepoint, moemoepoint_reserved
  `)

  const row = rows[0]
  if (!row) {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { moemoepoint: true, moemoepoint_reserved: true }
    })
    if (!user) {
      throw new MoemoepointUserNotFoundError()
    }
    if (user.moemoepoint_reserved + reservedDelta < 0) {
      throw new MoemoepointInvalidChangeError('待结算萌萌点不能小于零')
    }
    throw new MoemoepointInsufficientError()
  }

  const ledger = await tx.user_moemoepoint_ledger.create({
    data: {
      user_id: input.userId,
      kind: input.kind,
      balance_delta: input.balanceDelta,
      reserved_delta: reservedDelta,
      balance_after: row.moemoepoint,
      reserved_after: row.moemoepoint_reserved,
      reason_code: input.reasonCode.trim(),
      reason: normalizeMoemoepointReason(input.reason),
      reference_type: input.referenceType,
      reference_id:
        input.referenceId === undefined ? undefined : String(input.referenceId),
      link: input.link ?? '',
      operator_id: input.operatorId,
      reservation_id: input.reservationId,
      idempotency_key: input.idempotencyKey
    },
    select: { id: true }
  })

  return { balance: toBalance(row), ledgerId: ledger.id, applied: true }
}

export const earnMoemoepoint = (tx: Tx, input: AmountChangeInput) => {
  assertPositiveAmount(input.amount)
  return applyMoemoepointChange(tx, {
    ...input,
    kind: 'earn',
    balanceDelta: input.amount
  })
}

export const spendMoemoepoint = (
  tx: Tx,
  input: AmountChangeInput & { requiredAvailable?: number }
) => {
  assertPositiveAmount(input.amount)
  return applyMoemoepointChange(tx, {
    ...input,
    kind: 'spend',
    balanceDelta: -input.amount,
    requiredAvailable: input.requiredAvailable ?? input.amount
  })
}

export const refundMoemoepoint = (tx: Tx, input: AmountChangeInput) => {
  assertPositiveAmount(input.amount)
  return applyMoemoepointChange(tx, {
    ...input,
    kind: 'refund',
    balanceDelta: input.amount
  })
}

export const reverseMoemoepoint = (tx: Tx, input: AmountChangeInput) => {
  assertPositiveAmount(input.amount)
  return applyMoemoepointChange(tx, {
    ...input,
    kind: 'reversal',
    balanceDelta: -input.amount
  })
}

export const createMoemoepointOpeningEntry = async (
  tx: Tx,
  input: {
    userId: number
    balance: number
    reasonCode: string
    reason: string
    idempotencyKey: string
  }
) => {
  assertMetadata(input)
  // 余额为 0 时不写开户明细。新注册用户的初始余额就是 0, 写进去只会在明细页
  // 显示一行「初始余额 +0 +0 +0」的噪音。生产迁移脚本给存量用户回填的
  // opening 行余额非 0, 不受影响。
  if (input.balance === 0) {
    return null
  }
  return tx.user_moemoepoint_ledger.upsert({
    where: { idempotency_key: input.idempotencyKey },
    create: {
      user_id: input.userId,
      kind: 'opening',
      balance_delta: input.balance,
      reserved_delta: 0,
      balance_after: input.balance,
      reserved_after: 0,
      reason_code: input.reasonCode,
      reason: normalizeMoemoepointReason(input.reason),
      idempotency_key: input.idempotencyKey
    },
    update: {},
    select: { id: true }
  })
}

type ReservationInput = ChangeMetadata & {
  userId: number
  amount: number
  idempotencyKey: string
}

export const reserveMoemoepoint = async (tx: Tx, input: ReservationInput) => {
  assertPositiveAmount(input.amount)
  assertMetadata(input)

  const existing = await tx.user_moemoepoint_reservation.findUnique({
    where: { idempotency_key: input.idempotencyKey }
  })
  if (existing) {
    if (existing.user_id !== input.userId) {
      throw new MoemoepointInvalidChangeError('萌萌点暂扣幂等键已被占用')
    }
    return {
      reservation: existing,
      balance: await getCurrentBalance(tx, input.userId),
      applied: false
    }
  }

  const reservation = await tx.user_moemoepoint_reservation.create({
    data: {
      user_id: input.userId,
      amount: input.amount,
      reason_code: input.reasonCode.trim(),
      reason: normalizeMoemoepointReason(input.reason),
      reference_type: input.referenceType,
      reference_id:
        input.referenceId === undefined ? undefined : String(input.referenceId),
      link: input.link ?? '',
      idempotency_key: input.idempotencyKey
    }
  })

  const change = await applyMoemoepointChange(tx, {
    ...input,
    kind: 'reserve',
    balanceDelta: 0,
    reservedDelta: input.amount,
    requiredAvailable: input.amount,
    reservationId: reservation.id,
    idempotencyKey: `reservation:${reservation.id}:reserve`
  })

  return { reservation, balance: change.balance, applied: true }
}

type SettlementInput = {
  reservationId: number
  reasonCode: string
  reason: string
  idempotencyKey: string
  operatorId?: number
}

const settleMoemoepointReservation = async (
  tx: Tx,
  input: SettlementInput,
  status: Exclude<MoemoepointReservationStatus, 'pending'>
) => {
  assertMetadata(input)
  const reservation = await tx.user_moemoepoint_reservation.findUnique({
    where: { id: input.reservationId }
  })
  if (!reservation) {
    throw new MoemoepointReservationNotFoundError()
  }
  if (reservation.status !== 'pending') {
    if (
      reservation.status === status &&
      reservation.settlement_idempotency_key === input.idempotencyKey
    ) {
      return {
        reservation,
        balance: await getCurrentBalance(tx, reservation.user_id),
        applied: false
      }
    }
    throw new MoemoepointReservationSettledError()
  }

  const updated = await tx.user_moemoepoint_reservation.updateMany({
    where: { id: reservation.id, status: 'pending' },
    data: {
      status,
      settlement_idempotency_key: input.idempotencyKey,
      settlement_reason: normalizeMoemoepointReason(input.reason),
      settled_at: new Date(),
      settled_by_id: input.operatorId
    }
  })
  if (updated.count === 0) {
    throw new MoemoepointReservationSettledError()
  }

  const change = await applyMoemoepointChange(tx, {
    userId: reservation.user_id,
    kind: status === 'released' ? 'release' : 'forfeit',
    balanceDelta: status === 'forfeited' ? -reservation.amount : 0,
    reservedDelta: -reservation.amount,
    reasonCode: input.reasonCode,
    reason: input.reason,
    referenceType: reservation.reference_type ?? undefined,
    referenceId: reservation.reference_id ?? undefined,
    link: reservation.link,
    operatorId: input.operatorId,
    reservationId: reservation.id,
    idempotencyKey: `reservation:${reservation.id}:${status}`
  })

  const settled = await tx.user_moemoepoint_reservation.findUniqueOrThrow({
    where: { id: reservation.id }
  })
  return { reservation: settled, balance: change.balance, applied: true }
}

export const releaseMoemoepoint = (tx: Tx, input: SettlementInput) =>
  settleMoemoepointReservation(tx, input, 'released')

export const forfeitMoemoepoint = (tx: Tx, input: SettlementInput) =>
  settleMoemoepointReservation(tx, input, 'forfeited')
