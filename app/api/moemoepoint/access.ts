import type { KunGalgamePayload } from '~/app/api/utils/jwt'

export const MOEMOEPOINT_LEDGER_ADMIN_ROLE = 3

/**
 * 萌萌点明细属于账户隐私数据, 只有本人和管理员可以查看。
 *
 * 这个判断必须在每个入口独立执行 (页面、server action、API route),
 * 不能只靠布局隐藏入口。抽成函数是为了让阈值只有一个来源 ——
 * 之前 page / action / route 各写了一遍, 改阈值要改三处。
 */
export const canViewMoemoepointLedger = (
  payload: Pick<KunGalgamePayload, 'uid' | 'role'>,
  userId: number
) => payload.uid === userId || payload.role >= MOEMOEPOINT_LEDGER_ADMIN_ROLE
