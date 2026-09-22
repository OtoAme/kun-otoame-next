import type { Prisma, PrismaClient } from '@prisma/client'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import type {
  CompanyDatabaseState,
  CompanyState
} from './companyCleanupFrozenContract'
import {
  assertCounterContract,
  describeCompanyPostStateMismatch,
  lockCompanyMaintenanceTables,
  replaceAffectedCompanyState,
  setTransactionTimeouts
} from './companyCleanupFrozenApply'
import {
  applyActionsToCompanyDatabaseState,
  digestSemanticCompanyDatabaseState,
  getCompanyRef,
  loadCompanyDatabaseState
} from './companyCleanupFrozenState'

const DEFAULT_LOCK_TIMEOUT_MS = 10000
const DEFAULT_STATEMENT_TIMEOUT_MS = 120000

/**
 * A rejection the operator can act on. The message is written in Chinese and is
 * handed back to the dashboard verbatim, so every branch below has to explain
 * what to do next; anything else that escapes is reported as an unknown
 * failure instead of leaking a driver message.
 */
export class CompanyMergeApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanyMergeApplyError'
  }
}

/**
 * 主名原先挂在哪家参与会社上：先匹配主名，再匹配别名；多家长号取编号最小的。
 * 合并后那家的 `user_id` 会写到主会社上。
 */
export const ownerCompanyIdForSelectedName = (
  companies: Array<{ id: number; name: string; aliases: string[] }>,
  name: string
) => {
  const selected = name.trim()
  if (!selected) return null
  const asMain = companies.filter((company) => company.name === selected)
  if (asMain.length) {
    return Math.min(...asMain.map((company) => company.id))
  }
  const asAlias = companies.filter((company) =>
    company.aliases.includes(selected)
  )
  if (asAlias.length) {
    return Math.min(...asAlias.map((company) => company.id))
  }
  return null
}

export interface ApplySingleCompanyMergeInput {
  db: PrismaClient
  targetCompanyId: number
  sourceCompanyIds: number[]
  /** 主会社的新主名; 必须是参与会社的某个名称或别名 (trim 后完全相等)。 */
  name: string
  /**
   * 哪家参与会社的 `user_id` 写到主会社上。Dashboard 应设
   * `deriveOwnerFromSelectedName`，由主名原先所属会社推导。
   */
  ownerFromCompanyId?: number
  /** 为 true 时忽略 ownerFromCompanyId，按主名原先所属会社取值。 */
  deriveOwnerFromSelectedName?: boolean
  introductionFromCompanyId: number
  reason: string
  lockTimeoutMs?: number
  statementTimeoutMs?: number
  /**
   * Work that has to be atomic with the merge. `beforeCompanyLocks` runs after
   * the transaction timeouts and before any company-table lock (advisory lock,
   * then suggestion rows). `beforeApply` runs once the maintenance locks are
   * held and before any company write. `afterApply` runs after the merge has
   * been verified, still inside the transaction, so a failure there rolls the
   * merge back instead of leaving it unrecorded.
   */
  hooks?: {
    beforeCompanyLocks?: (tx: Prisma.TransactionClient) => Promise<void>
    beforeApply?: (tx: Prisma.TransactionClient) => Promise<void>
    afterApply?: (tx: Prisma.TransactionClient) => Promise<void>
  }
}

export interface ApplySingleCompanyMergeResult {
  databaseStatus: 'applied' | 'already-applied'
  /** 参与合并的会社 (存续 + 被并走), 供提交后失效会社缓存。 */
  affectedCompanyIds: number[]
  /** 合并后挂在存续会社上的作品, 供提交后失效条目缓存。 */
  patchUniqueIds: string[]
}

const sortedUniqueNumbers = (values: number[]) =>
  [...new Set(values)].sort((left, right) => left - right)

const uniqueSortedValues = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, 'en')
  )

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * 目标会社是否已经带着这个名字: 合并过一次之后, 选中的主名会落成主名或别名,
 * 所以这就是「这次合并已经生效」的判据。
 */
const carriesName = (company: CompanyState, name: string) =>
  company.name === name ||
  company.aliases.includes(name) ||
  company.identities.some((identity) => identity.value === name)

/**
 * 把操作者选中的主名写进目标会社的内存副本。`buildExpectedTarget` 用副本的
 * name / normalizedName 生成新的主名身份, 所以旧主名必须先降级成别名, 否则它会
 * 跟着旧的主名身份一起消失, 搜索就再也找不到它了。
 *
 * `ref` 是从「id + 主名 + 归一化名」算出来的, 改了主名就得跟着重算, 否则内存终态
 * 会和从库里读回来的终态对不上。
 */
const applyChosenName = (
  state: CompanyDatabaseState,
  target: CompanyState,
  participantIds: Set<number>,
  name: string
) => {
  if (target.name === name) return

  const normalizedName = normalizeCompanyValue(name)
  if (!normalizedName) {
    throw new CompanyMergeApplyError('主名不能为空')
  }

  if (target.normalizedName === normalizedName) {
    // 只差大小写或空白: 归一化名没变, 改主名身份的值就够, 不需要再加别名。
    target.name = name
    target.identities = target.identities.map((identity) =>
      identity.kind === 'name' ? { ...identity, value: name } : identity
    )
    return
  }

  const owner = state.companies.find(
    (company) =>
      !participantIds.has(company.id) &&
      company.normalizedName === normalizedName
  )
  if (owner) {
    throw new CompanyMergeApplyError(
      `主名「${name}」已经是会社 #${owner.id} 的名称，请改选其它主名，或先处理那家会社`
    )
  }

  const previousName = target.name
  target.name = name
  target.normalizedName = normalizedName
  target.ref = getCompanyRef({
    id: target.id,
    name,
    normalizedName
  })
  target.identities = target.identities.map((identity) =>
    identity.kind === 'name'
      ? { ...identity, kind: 'alias' as const }
      : identity
  )
  target.aliases = uniqueSortedValues([...target.aliases, previousName])
}

/**
 * 身份行必须恰好是「主名 + 别名」的投影。引擎会把来源会社的主名一律降级成别名
 * 身份, 所以当操作者选中的主名正好等于某个参与会社的名称或别名时, 存续会社可能
 * 同时拿到 `name` 与同值的 `alias` 两行; `patch_company.alias` 那一列用的是同一套
 * 归一化规则, 已经把这个值排除了。这里只清掉被自己的主名遮住的那一行, 免得留下
 * 一条「既是主名又是别名」的身份。
 */
const dropIdentitiesShadowedByMainName = (
  state: CompanyDatabaseState,
  targetCompanyId: number
) => {
  const target = state.companies.find(
    (company) => company.id === targetCompanyId
  )
  if (!target) return
  target.identities = target.identities.filter(
    (identity) =>
      identity.kind !== 'alias' ||
      identity.normalizedValue !== target.normalizedName
  )
}

/**
 * 管理端单笔会社合并。和离线清理走同一套写入器: 同一个事务、同样的锁与超时、
 * 同样的计数器契约、同样的整段替换与写入后校验, 因此合并语义 (源会社删除、
 * 关系并集、名称留作别名、旧 URL 直接 404) 与冻结计划完全一致。
 *
 * 与离线计划唯一的差别是「预期终态」不在计划文件里, 而是本次调用在事务内算出来
 * 的, 所以没有任何 SHA 校验位可言: 幂等靠 `already-applied` 分支, 冲突靠
 * `assertFinalGlobalIdentityOwnership` 抛错回滚。
 */
export const applySingleCompanyMerge = async (
  input: ApplySingleCompanyMergeInput
): Promise<ApplySingleCompanyMergeResult> => {
  const name = input.name.trim()
  const sourceCompanyIds = sortedUniqueNumbers(input.sourceCompanyIds)
  if (
    !sourceCompanyIds.length ||
    sourceCompanyIds.includes(input.targetCompanyId)
  ) {
    throw new CompanyMergeApplyError(
      '合并需要至少一家被并走的会社，且不能与存续会社重复'
    )
  }

  const participantIds = new Set([input.targetCompanyId, ...sourceCompanyIds])
  if (!participantIds.has(input.introductionFromCompanyId)) {
    throw new CompanyMergeApplyError('介绍的来源必须是本次合并的参与会社')
  }
  if (
    !input.deriveOwnerFromSelectedName &&
    (input.ownerFromCompanyId === undefined ||
      !participantIds.has(input.ownerFromCompanyId))
  ) {
    throw new CompanyMergeApplyError(
      '记录所有者的来源必须是本次合并的参与会社'
    )
  }

  const lockTimeoutMs = input.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const statementTimeoutMs =
    input.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS

  return input.db.$transaction(
    async (tx) => {
      await setTransactionTimeouts(tx, lockTimeoutMs, statementTimeoutMs)
      await input.hooks?.beforeCompanyLocks?.(tx)
      await lockCompanyMaintenanceTables(tx)
      await assertCounterContract(tx)
      await input.hooks?.beforeApply?.(tx)

      const current = await loadCompanyDatabaseState(tx)
      const byId = new Map(
        current.companies.map((company) => [company.id, company])
      )
      const target = byId.get(input.targetCompanyId)
      const missingSourceIds = sourceCompanyIds.filter(
        (companyId) => !byId.has(companyId)
      )

      if (!target) {
        throw new CompanyMergeApplyError(
          `主会社 #${input.targetCompanyId} 已不存在，本次合并未执行`
        )
      }

      if (
        missingSourceIds.length === sourceCompanyIds.length &&
        carriesName(target, name)
      ) {
        // 上一次请求已经提交过这次合并 (建议行的状态没落库, 或者操作者重试),
        // 会社数据已经是终态, 不再写第二遍。
        await input.hooks?.afterApply?.(tx)
        return {
          databaseStatus: 'already-applied' as const,
          affectedCompanyIds: [input.targetCompanyId, ...sourceCompanyIds],
          patchUniqueIds: target.relations.map(
            (relation) => relation.patchUniqueId
          )
        }
      }

      if (missingSourceIds.length) {
        throw new CompanyMergeApplyError(
          `会社 #${missingSourceIds.join('、#')} 已不存在，本次合并未执行，请刷新列表后重试`
        )
      }

      const sources = sourceCompanyIds.map((companyId) => byId.get(companyId)!)
      const availableNames = new Set(
        [target, ...sources].flatMap((company) => [
          company.name,
          ...company.aliases
        ])
      )
      if (!availableNames.has(name)) {
        throw new CompanyMergeApplyError(
          `主名「${name}」不是本次合并参与会社的名称或别名，请刷新列表后重试`
        )
      }

      const ownerFromCompanyId = input.deriveOwnerFromSelectedName
        ? ownerCompanyIdForSelectedName([target, ...sources], name)
        : input.ownerFromCompanyId
      if (
        ownerFromCompanyId === null ||
        ownerFromCompanyId === undefined ||
        !participantIds.has(ownerFromCompanyId)
      ) {
        throw new CompanyMergeApplyError(
          `无法确定主名「${name}」原先所属会社的记录所有者`
        )
      }

      const preState = structuredClone(current)
      applyChosenName(
        preState,
        preState.companies.find(
          (company) => company.id === input.targetCompanyId
        )!,
        participantIds,
        name
      )

      let merged: ReturnType<typeof applyActionsToCompanyDatabaseState>
      try {
        merged = applyActionsToCompanyDatabaseState(
          preState,
          [],
          [
            {
              kind: 'manual',
              targetCompanyId: input.targetCompanyId,
              sourceCompanyIds,
              ownerFromCompanyId,
              introductionFromCompanyId: input.introductionFromCompanyId,
              reason: input.reason
            }
          ],
          []
        )
      } catch (error) {
        throw new CompanyMergeApplyError(
          `合并后的会社身份与现有数据冲突：${describeError(error)}。本次合并未执行`
        )
      }

      dropIdentitiesShadowedByMainName(merged.state, input.targetCompanyId)
      const mergedTarget = merged.state.companies.find(
        (company) => company.id === input.targetCompanyId
      )!
      // 合并动作里的快照跟着内存终态一起更新, 免得返回值里留着被修正前的版本。
      for (const action of merged.mergeActions) {
        if (action.expectedTarget.id === input.targetCompanyId) {
          action.expectedTarget = mergedTarget
        }
      }

      const expectedPostDatabaseDigest = digestSemanticCompanyDatabaseState(
        merged.state
      )
      await replaceAffectedCompanyState(tx, {
        affectedCompanyIds: [input.targetCompanyId, ...sourceCompanyIds],
        expectedPostState: merged.state
      })
      await assertCounterContract(tx)
      const postState = await loadCompanyDatabaseState(tx)
      if (
        digestSemanticCompanyDatabaseState(postState) !==
        expectedPostDatabaseDigest
      ) {
        throw new CompanyMergeApplyError(
          `会社数据写入后的校验未通过，事务已回滚：${describeCompanyPostStateMismatch(
            postState,
            merged.state
          )}`
        )
      }

      await input.hooks?.afterApply?.(tx)
      return {
        databaseStatus: 'applied' as const,
        affectedCompanyIds: [input.targetCompanyId, ...sourceCompanyIds],
        patchUniqueIds: merged.state.companies
          .filter((company) => company.id === input.targetCompanyId)
          .flatMap((company) =>
            company.relations.map((relation) => relation.patchUniqueId)
          )
      }
    },
    { timeout: Math.min(statementTimeoutMs + 10000, 310000) }
  )
}
