import { suggestSuffixUniqueHits } from '~/app/api/company/identity/suffixSuggestions'
import { prisma } from '~/prisma/index'
import {
  CompanyMergeApplyError,
  applySingleCompanyMerge,
  type ApplySingleCompanyMergeResult
} from '~/scripts/companyCleanupDashboardMerge'
import type {
  CompanyMergeApplyResponse,
  CompanyMergeDetectResponse,
  CompanyMergeDismissResponse,
  CompanyMergeParticipant,
  CompanyMergeSuggestionListResponse
} from '~/types/api/companyMerges'

const SUFFIX_UNIQUE_HIT_KIND = 'suffix-unique-hit'
const PENDING = 'pending'
const DISMISSED = 'dismissed'
const ACCEPTED = 'accepted'
const INTRODUCTION_PREVIEW_LENGTH = 60

/**
 * 列表要显示的参与者字段。`introduction` 只发开头一段: 一屏最多几十行、每行几家
 * 会社, 整段介绍 (上限 10007 字) 会把列表接口撑成正文接口。
 */
const COMPANY_MERGE_PARTICIPANT_SELECT = {
  id: true,
  name: true,
  alias: true,
  introduction: true,
  user_id: true,
  official_website: true,
  parent_brand: true
} as const

const toIntroductionPreview = (introduction: string) => {
  const collapsed = introduction.replace(/\s+/g, ' ').trim()
  return collapsed.length > INTRODUCTION_PREVIEW_LENGTH
    ? `${collapsed.slice(0, INTRODUCTION_PREVIEW_LENGTH)}…`
    : collapsed
}

const uniqueSorted = (values: string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))

export const listCompanyMergeSuggestions =
  async (): Promise<CompanyMergeSuggestionListResponse> => {
    const rows = await prisma.company_merge_suggestion.findMany({
      where: { status: PENDING },
      orderBy: [{ detected_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        kind: true,
        folded_key: true,
        target_company_id: true,
        source_company_ids: true,
        names: true,
        detected_at: true
      }
    })
    if (rows.length === 0) {
      return { items: [] }
    }

    const participantIds = [
      ...new Set(
        rows.flatMap((row) => [
          row.target_company_id,
          ...row.source_company_ids
        ])
      )
    ]
    const companies = await prisma.patch_company.findMany({
      where: { id: { in: participantIds } },
      select: COMPANY_MERGE_PARTICIPANT_SELECT
    })
    const companyById = new Map(
      companies.map((company) => [company.id, company])
    )

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: PENDING,
        foldedKey: row.folded_key,
        targetCompanyId: row.target_company_id,
        sourceCompanyIds: row.source_company_ids,
        names: row.names,
        participants: [row.target_company_id, ...row.source_company_ids].map(
          (companyId): CompanyMergeParticipant => {
            const company = companyById.get(companyId)
            return {
              companyId,
              name: company?.name ?? null,
              aliases: company ? uniqueSorted(company.alias) : [],
              introductionPreview: company
                ? toIntroductionPreview(company.introduction)
                : '',
              ownerId: company?.user_id ?? null,
              officialWebsites: company ? [...company.official_website] : [],
              parentBrands: company ? [...company.parent_brand] : []
            }
          }
        ),
        detectedAt: row.detected_at.toISOString()
      }))
    }
  }

type ScannedCompany = {
  id: number
  name: string
  normalized_name: string | null
  alias: string[]
  name_identities: Array<{
    origin: string
    kind: string
    normalized_value: string
  }>
  external_ids: Array<{ source: string; external_id: string }>
}

/**
 * `suggestSuffixUniqueHits` takes one id per source, but the table allows a
 * company to hold several ids for the same source. Such a company has no
 * unambiguous external identity, so it is dropped from the scan instead of
 * being compared on a key we cannot trust. Returns `null` for that case.
 */
const toExternalIdRecord = (
  rows: ScannedCompany['external_ids']
): Record<string, string> | null => {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const source = row.source.trim()
    const value = row.external_id.trim()
    if (!source || !value) continue
    const seen = record[source]
    if (seen === undefined) {
      record[source] = value
      continue
    }
    if (seen !== value) return null
  }
  return record
}

const loadClusterInput = async () => {
  const companies = await prisma.patch_company.findMany({
    select: {
      id: true,
      name: true,
      normalized_name: true,
      alias: true,
      name_identities: {
        select: { origin: true, kind: true, normalized_value: true }
      },
      external_ids: { select: { source: true, external_id: true } }
    }
  })

  return companies.flatMap((company) => {
    const externalIds = toExternalIdRecord(company.external_ids)
    if (externalIds === null) return []

    return [
      {
        id: company.id,
        name: company.name,
        normalizedName: company.normalized_name,
        alias: company.alias,
        identities: company.name_identities.map((identity) => ({
          origin: identity.origin,
          kind: identity.kind,
          normalizedValue: identity.normalized_value
        })),
        externalIds
      }
    ]
  })
}

/**
 * Read-only scan of `patch_company`, then an upsert of the resulting clusters
 * into the queue. Existing pending rows are refreshed in place; a key that was
 * dismissed is counted and left untouched, because this stage has no explicit
 * reopen action. No company is ever written.
 */
export const detectCompanyMergeSuggestions =
  async (): Promise<CompanyMergeDetectResponse> => {
    const suggestions = suggestSuffixUniqueHits(await loadClusterInput())
    if (suggestions.length === 0) {
      return { created: 0, updated: 0, skipped: 0 }
    }

    const existing = await prisma.company_merge_suggestion.findMany({
      where: {
        kind: SUFFIX_UNIQUE_HIT_KIND,
        status: { in: [PENDING, DISMISSED] }
      },
      select: { id: true, folded_key: true, status: true }
    })

    const pendingIdByKey = new Map<string, number>()
    const dismissedKeys = new Set<string>()
    for (const row of existing) {
      if (row.status === PENDING) {
        if (!pendingIdByKey.has(row.folded_key)) {
          pendingIdByKey.set(row.folded_key, row.id)
        }
        continue
      }
      dismissedKeys.add(row.folded_key)
    }

    const detectedAt = new Date()
    let created = 0
    let updated = 0
    let skipped = 0

    for (const suggestion of suggestions) {
      const cluster = {
        target_company_id: suggestion.targetCompanyId,
        source_company_ids: suggestion.sourceCompanyIds,
        names: suggestion.names,
        evidence: {
          kind: suggestion.kind,
          foldedKey: suggestion.foldedKey
        },
        detected_at: detectedAt
      }

      const pendingId = pendingIdByKey.get(suggestion.foldedKey)
      if (pendingId !== undefined) {
        await prisma.company_merge_suggestion.update({
          where: { id: pendingId },
          data: cluster
        })
        updated += 1
        continue
      }

      if (dismissedKeys.has(suggestion.foldedKey)) {
        skipped += 1
        continue
      }

      await prisma.company_merge_suggestion.create({
        data: {
          ...cluster,
          kind: suggestion.kind,
          status: PENDING,
          folded_key: suggestion.foldedKey
        }
      })
      created += 1
    }

    return { created, updated, skipped }
  }

/**
 * Dismiss one pending row and record who did it. The status guard lives in the
 * `updateMany` filter so two reviewers clicking at once cannot both win; the
 * follow-up read only runs to tell "already resolved" apart from "no such row".
 */
export const dismissCompanyMergeSuggestion = async (
  id: number,
  userId: number
): Promise<CompanyMergeDismissResponse | string> => {
  const result = await prisma.company_merge_suggestion.updateMany({
    where: { id, status: PENDING },
    data: {
      status: DISMISSED,
      resolved_at: new Date(),
      resolved_by_user_id: userId
    }
  })

  if (result.count > 0) {
    return { id }
  }

  const existing = await prisma.company_merge_suggestion.findUnique({
    where: { id },
    select: { id: true }
  })

  return existing ? '该建议已处理，无法重复驳回' : '未找到该会社合并建议'
}

/**
 * 缓存失效。合并已经提交, 这里失败不能让数据回滚, 所以只回报一条提示; Redis 与
 * Cloudflare 的客户端因此按需加载 —— 维护脚本也是这么做的, 免得把一个常驻连接
 * 拖进这条路由的模块图。
 */
const invalidateMergedCompanyCaches = async (
  result: ApplySingleCompanyMergeResult
): Promise<string | null> => {
  try {
    const { invalidateCompanyCaches, invalidatePatchContentCache } =
      await import('~/app/api/patch/cache')
    await Promise.all([
      ...result.affectedCompanyIds.map((companyId) =>
        invalidateCompanyCaches(companyId)
      ),
      ...result.patchUniqueIds.map((uniqueId) =>
        invalidatePatchContentCache(uniqueId)
      )
    ])
    return null
  } catch (error) {
    console.error('Company merge cache invalidation failed:', error)
    return '合并已经写入数据库，但缓存失效失败：页面可能仍显示旧数据，请稍后重试。'
  }
}

/**
 * Apply one queued suggestion. The primary company is always the smallest id
 * in the cluster. The operator picks the main name and introduction source;
 * owner comes from whichever participant originally held that name.
 *
 * The suggestion row is written in the same transaction as the companies, so a
 * crash can never leave "companies merged but suggestion still pending". The
 * reverse race — another operator resolving the same row first — is caught by
 * the `status: pending` guard inside that transaction and merges nothing.
 */
export const applyCompanyMergeSuggestion = async (
  input: {
    id: number
    name: string
    introductionFromCompanyId: number
    targetCompanyId?: number
    ownerFromCompanyId?: number
  },
  userId: number
): Promise<CompanyMergeApplyResponse | string> => {
  const suggestion = await prisma.company_merge_suggestion.findFirst({
    where: { id: input.id, status: PENDING },
    select: { id: true, target_company_id: true, source_company_ids: true }
  })
  if (!suggestion) {
    const existing = await prisma.company_merge_suggestion.findUnique({
      where: { id: input.id },
      select: { id: true }
    })
    return existing ? '该建议已处理，无法再次合并' : '未找到该会社合并建议'
  }

  const clusterIds = [
    suggestion.target_company_id,
    ...suggestion.source_company_ids
  ]
  const targetCompanyId = Math.min(...clusterIds)
  const sourceCompanyIds = clusterIds.filter(
    (companyId) => companyId !== targetCompanyId
  )
  if (sourceCompanyIds.length === 0) {
    return '该建议没有可被合并的其它会社'
  }
  if (!clusterIds.includes(input.introductionFromCompanyId)) {
    return '介绍的来源必须是该建议涉及的会社之一'
  }

  let result: ApplySingleCompanyMergeResult
  try {
    result = await applySingleCompanyMerge({
      db: prisma,
      targetCompanyId,
      sourceCompanyIds,
      name: input.name,
      deriveOwnerFromSelectedName: true,
      introductionFromCompanyId: input.introductionFromCompanyId,
      reason: `Dashboard merge of suggestion #${suggestion.id}`,
      hooks: {
        // 事务内重读建议行: 检测可能刚刷新过这一簇 (加进或移走一家会社), 所以要求
        // 参与会社的集合完全一致, 而不是只要求提交的 id 还在簇里。
        beforeApply: async (tx) => {
          const locked = await tx.company_merge_suggestion.findFirst({
            where: { id: input.id, status: PENDING },
            select: { target_company_id: true, source_company_ids: true }
          })
          if (!locked) {
            throw new CompanyMergeApplyError('该建议已被处理，请刷新列表')
          }
          const lockedIds = new Set([
            locked.target_company_id,
            ...locked.source_company_ids
          ])
          if (
            lockedIds.size !== clusterIds.length ||
            clusterIds.some((companyId) => !lockedIds.has(companyId))
          ) {
            throw new CompanyMergeApplyError(
              '该建议涉及的会社已经变化，请刷新列表后重新确认'
            )
          }
        },
        afterApply: async (tx) => {
          const accepted = await tx.company_merge_suggestion.updateMany({
            where: { id: input.id, status: PENDING },
            data: {
              status: ACCEPTED,
              resolved_at: new Date(),
              resolved_by_user_id: userId
            }
          })
          if (accepted.count === 0) {
            throw new CompanyMergeApplyError(
              '该建议已被他人处理，本次合并没有提交'
            )
          }
        }
      }
    })
  } catch (error) {
    if (error instanceof CompanyMergeApplyError) {
      return error.message
    }
    console.error('Company merge apply failed:', error)
    return '合并失败，会社数据未改动，请刷新列表后重试'
  }

  const cacheWarning = await invalidateMergedCompanyCaches(result)
  return {
    id: suggestion.id,
    targetCompanyId,
    databaseStatus: result.databaseStatus,
    ...(cacheWarning ? { cacheWarning } : {})
  }
}
