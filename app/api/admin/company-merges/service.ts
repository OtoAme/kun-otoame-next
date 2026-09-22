import { suggestSuffixUniqueHits } from '~/app/api/company/identity/suffixSuggestions'
import { suggestNameVariantHits } from '~/app/api/company/identity/nameVariantSuggestions'
import {
  SOURCE_PAIR_KIND,
  suggestSourcePairHits,
  type SourcePairPatch,
  type SourcePairSuggestion
} from '~/app/api/company/identity/sourcePairSuggestions'
import {
  createNextmoeCatalogClient,
  isNextmoeCatalogConfigured
} from '~/app/api/company/nextmoe/client'
import { loadVndbDevelopers as loadVndbDevelopersDefault } from '~/app/api/edit/vndbCompanyCandidates'
import type { VndbProducer } from '~/lib/arnebiae/vndb'
import type {
  NextmoeCompanyList,
  NextmoeWorkList
} from '~/app/api/company/nextmoe/types'
import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  CompanyMergeApplyError,
  applySingleCompanyMerge,
  type ApplySingleCompanyMergeResult
} from '~/scripts/companyCleanupDashboardMerge'
import type {
  CompanyMergeApplyResponse,
  CompanyMergeDetectProgress,
  CompanyMergeDetectResponse,
  CompanyMergeDismissResponse,
  CompanyMergeParticipant,
  CompanyMergeReopenResponse,
  CompanyMergeSuggestionListResponse,
  CompanyMergeSuggestionStatus
} from '~/types/api/companyMerges'
import { writePartialMergeExclusions } from './autoExclude'
import {
  lockCompanyMergeQueue,
  lockCompanyMergeSuggestionRows
} from './queueLock'
import {
  CompanyMergeMemberKeyError,
  assertCompanyMergeEvidence,
  parseCompanyMergeEvidenceHits,
  readResolutionSource,
  readStoredCompanyIds,
  toCandidateKey,
  toMemberKey
} from '~/validations/companyMerges'

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export type DetectCompanyMergeSuggestionsOptions = {
  loadVndbDevelopers?: (vndbId: string) => Promise<VndbProducer[]>
  listNextmoeWorksByRefs?: (refs: string[]) => Promise<NextmoeWorkList>
  listNextmoeCompaniesByIds?: (ids: string[]) => Promise<NextmoeCompanyList>
  isNextmoeConfigured?: () => boolean
  sleep?: (ms: number) => Promise<void>
  onProgress?: (event: CompanyMergeDetectProgress) => void
}

type DetectedSuggestion = {
  kind: string
  targetCompanyId: number
  sourceCompanyIds: number[]
  foldedKey: string
  names: string[]
  evidence?: SourcePairSuggestion['evidence']
}

const clusterIdKey = (
  targetCompanyId: number,
  sourceCompanyIds: number[] | null | undefined
) =>
  [targetCompanyId, ...(sourceCompanyIds ?? [])]
    .sort((left, right) => left - right)
    .join(',')
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

export const listCompanyMergeSuggestions = async (
  status: CompanyMergeSuggestionStatus = PENDING
): Promise<CompanyMergeSuggestionListResponse> => {
  const rows = await prisma.company_merge_suggestion.findMany({
    where: { status },
    orderBy:
      status === PENDING
        ? [{ detected_at: 'desc' }, { id: 'desc' }]
        : [{ resolved_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      kind: true,
      folded_key: true,
      target_company_id: true,
      source_company_ids: true,
      names: true,
      evidence: true,
      detected_at: true,
      resolved_at: true,
      resolved_by_user_id: true,
      selected_company_ids: true,
      applied_source_company_ids: true,
      applied_target_company_id: true,
      resolution_source: true
    }
  })
  if (rows.length === 0) {
    return { items: [] }
  }

  const participantIds = [
    ...new Set(
      rows.flatMap((row) => [row.target_company_id, ...row.source_company_ids])
    )
  ]
  const companies = await prisma.patch_company.findMany({
    where: { id: { in: participantIds } },
    select: COMPANY_MERGE_PARTICIPANT_SELECT
  })
  const companyById = new Map(companies.map((company) => [company.id, company]))

  const resolverIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.resolved_by_user_id == null ? [] : [row.resolved_by_user_id]
      )
    )
  ]
  const resolverNameById = new Map<number, string>()
  if (resolverIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: resolverIds } },
      select: { id: true, name: true }
    })
    for (const user of users) {
      resolverNameById.set(user.id, user.name)
    }
  }

  return {
    items: rows.map((row) => {
      const resolvedByName =
        row.resolved_by_user_id == null
          ? undefined
          : resolverNameById.get(row.resolved_by_user_id)
      return {
        id: row.id,
        kind: row.kind,
        status,
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
        detectedAt: row.detected_at.toISOString(),
        resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
        resolvedByUserId: row.resolved_by_user_id,
        ...(resolvedByName ? { resolvedByName } : {}),
        selectedCompanyIds: readStoredCompanyIds(row.selected_company_ids, 2),
        appliedTargetCompanyId:
          typeof row.applied_target_company_id === 'number'
            ? row.applied_target_company_id
            : null,
        appliedSourceCompanyIds: readStoredCompanyIds(
          row.applied_source_company_ids,
          1
        ),
        resolutionSource: readResolutionSource(row.resolution_source),
        hits: parseCompanyMergeEvidenceHits(row.evidence, [
          row.target_company_id,
          ...row.source_company_ids
        ])
      }
    })
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

const rememberSuggestion = (
  byCluster: Map<string, DetectedSuggestion>,
  suggestion: DetectedSuggestion
) => {
  const key = clusterIdKey(
    suggestion.targetCompanyId,
    suggestion.sourceCompanyIds
  )
  const previous = byCluster.get(key)
  if (
    !previous ||
    suggestion.sourceCompanyIds.length > previous.sourceCompanyIds.length
  ) {
    byCluster.set(key, suggestion)
  }
}

const loadSourcePairPatches = async (): Promise<SourcePairPatch[]> => {
  const patches = await prisma.patch.findMany({
    where: {
      OR: [{ vndb_id: { not: null } }, { bangumi_id: { not: null } }]
    },
    select: {
      id: true,
      vndb_id: true,
      bangumi_id: true,
      company: { select: { company_id: true } }
    }
  })
  return patches.flatMap((patch) => {
    const companyIds = [...new Set(patch.company.map((row) => row.company_id))]
    if (companyIds.length < 2) return []
    return [
      {
        id: patch.id,
        vndbId: patch.vndb_id,
        bangumiId: patch.bangumi_id,
        companyIds
      }
    ]
  })
}

const collectSourcePairSuggestions = async (
  companies: Awaited<ReturnType<typeof loadClusterInput>>,
  options: DetectCompanyMergeSuggestionsOptions
): Promise<SourcePairSuggestion[]> => {
  const patches = await loadSourcePairPatches()
  if (patches.length === 0) return []

  const sleep = options.sleep ?? defaultSleep
  const nextmoeConfigured =
    options.isNextmoeConfigured ?? isNextmoeCatalogConfigured
  let listWorks = options.listNextmoeWorksByRefs
  if (nextmoeConfigured() && !listWorks) {
    const client = createNextmoeCatalogClient({ sleep })
    listWorks = (refs) => client.listWorksByRefs(refs)
  }

  return suggestSourcePairHits(companies, patches, {
    loadVndbDevelopers: options.loadVndbDevelopers ?? loadVndbDevelopersDefault,
    listNextmoeWorksByRefs: listWorks,
    isNextmoeConfigured: nextmoeConfigured,
    sleep,
    onProgress: options.onProgress
  })
}

const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue

const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002'

const sameIdSet = (left: readonly number[], right: readonly number[]) => {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return left.every((id) => rightIds.has(id))
}

type PlannedSuggestion = {
  suggestion: DetectedSuggestion
  companyIds: number[]
  memberKey: string
  candidateKey: string
  evidence: ReturnType<typeof assertCompanyMergeEvidence>
}

type QueueRow = {
  id: number
  status: string
  member_key: string
  candidate_key: string | null
}

const candidateKeyFor = (suggestion: DetectedSuggestion) => {
  const companyIds = [
    suggestion.targetCompanyId,
    ...suggestion.sourceCompanyIds
  ]
  if (suggestion.kind === SOURCE_PAIR_KIND && suggestion.evidence) {
    return toCandidateKey({
      kind: suggestion.kind,
      companyIds,
      upstreamIds: suggestion.evidence.upstreamIds,
      patchId: suggestion.evidence.patchId
    })
  }
  return toCandidateKey({ kind: suggestion.kind, companyIds })
}

const evidenceFor = (suggestion: DetectedSuggestion) => {
  const companyIds = [
    suggestion.targetCompanyId,
    ...suggestion.sourceCompanyIds
  ]
  if (suggestion.kind === SOURCE_PAIR_KIND && suggestion.evidence) {
    return assertCompanyMergeEvidence(
      {
        kind: suggestion.evidence.kind,
        patchId: suggestion.evidence.patchId,
        upstreamIds: suggestion.evidence.upstreamIds,
        bag: suggestion.evidence.bag,
        hits: suggestion.evidence.hits
      },
      companyIds
    )
  }
  return assertCompanyMergeEvidence(
    {
      kind: suggestion.kind,
      foldedKey: suggestion.foldedKey,
      hits: []
    },
    companyIds
  )
}

/**
 * Read-only scan of `patch_company`, then write suggestions. Skip identity is
 * `member_key`, never `folded_key`. Source-pair rows are found again by
 * `candidate_key` when the member set changes. No company is written.
 */
export const detectCompanyMergeSuggestions = async (
  options: DetectCompanyMergeSuggestionsOptions = {}
): Promise<CompanyMergeDetectResponse> => {
  const started = Date.now()
  const earlyNotes: string[] = []
  const report = (event: CompanyMergeDetectProgress) => {
    options.onProgress?.(event)
  }
  // eslint-disable-next-line no-console
  console.info('[company-merges:detect] start')
  report({
    phase: 'local',
    current: 0,
    total: 1,
    detail: '正在读取会社'
  })
  const companies = await loadClusterInput()
  // eslint-disable-next-line no-console
  console.info(`[company-merges:detect] companies=${companies.length}`)
  const byCluster = new Map<string, DetectedSuggestion>()
  for (const suggestion of [
    ...suggestSuffixUniqueHits(companies),
    ...suggestNameVariantHits(companies)
  ]) {
    rememberSuggestion(byCluster, suggestion)
  }
  report({
    phase: 'local',
    current: 1,
    total: 1,
    detail: '本地规则已完成'
  })
  try {
    const sourcePairs = await collectSourcePairSuggestions(companies, options)
    for (const suggestion of sourcePairs) {
      rememberSuggestion(byCluster, suggestion)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[company-merges:detect] source-pair failed:', error)
    earlyNotes.push('来源别名扫描失败，已跳过，仅保留本地规则结果')
  }
  const suggestions = [...byCluster.values()]
  if (suggestions.length === 0) {
    const durationMs = Date.now() - started
    // eslint-disable-next-line no-console
    console.info(`[company-merges:detect] done ${durationMs}ms clusters=0`)
    return { created: 0, updated: 0, skipped: 0, durationMs, notes: earlyNotes }
  }

  const planned: PlannedSuggestion[] = []
  let earlySkipped = 0
  for (const suggestion of suggestions) {
    try {
      const companyIds = [
        suggestion.targetCompanyId,
        ...suggestion.sourceCompanyIds
      ]
      planned.push({
        suggestion,
        companyIds,
        memberKey: toMemberKey(companyIds),
        candidateKey: candidateKeyFor(suggestion),
        evidence: evidenceFor(suggestion)
      })
    } catch (error) {
      earlySkipped += 1
      earlyNotes.push(
        error instanceof Error ? error.message : '会社组合无法写入建议'
      )
    }
  }
  if (planned.length === 0) {
    const durationMs = Date.now() - started
    return {
      created: 0,
      updated: 0,
      skipped: earlySkipped,
      durationMs,
      notes: earlyNotes
    }
  }

  const plannedMemberKeys = [...new Set(planned.map((item) => item.memberKey))]
  const plannedCandidateKeys = [
    ...new Set(planned.map((item) => item.candidateKey))
  ]
  const queueWhere = {
    OR: [
      { member_key: { in: plannedMemberKeys } },
      { candidate_key: { in: plannedCandidateKeys } }
    ]
  }
  const queueSelect = {
    id: true,
    status: true,
    member_key: true,
    candidate_key: true
  } as const

  report({
    phase: 'write',
    current: 0,
    total: 1,
    detail: '正在写入合并建议'
  })
  try {
    const written = await prisma.$transaction(
      async (tx) => {
        await lockCompanyMergeQueue(tx)
        const discovered = await tx.company_merge_suggestion.findMany({
          where: queueWhere,
          select: queueSelect
        })
        const touchKeys = new Set<string>(plannedMemberKeys)
        for (const row of discovered) {
          if (row.member_key) touchKeys.add(row.member_key)
        }
        await lockCompanyMergeSuggestionRows(tx, [...touchKeys])
        const existing = await tx.company_merge_suggestion.findMany({
          where: queueWhere,
          select: queueSelect
        })

        const relevant = existing.flatMap((row): QueueRow[] => {
          if (!row.member_key) return []
          const matchesMember = plannedMemberKeys.includes(row.member_key)
          const matchesCandidate =
            row.candidate_key != null &&
            plannedCandidateKeys.includes(row.candidate_key)
          if (!matchesMember && !matchesCandidate) return []
          return [
            {
              id: row.id,
              status: row.status,
              member_key: row.member_key,
              candidate_key: row.candidate_key
            }
          ]
        })
        const pendingByMember = new Map<string, QueueRow>()
        const pendingByCandidate = new Map<string, QueueRow>()
        for (const row of relevant) {
          if (row.status !== PENDING) continue
          if (!pendingByMember.has(row.member_key)) {
            pendingByMember.set(row.member_key, row)
          }
          if (
            row.candidate_key &&
            !pendingByCandidate.has(row.candidate_key)
          ) {
            pendingByCandidate.set(row.candidate_key, row)
          }
        }
        const blocksMemberKey = (memberKey: string) =>
          relevant.some(
            (row) =>
              row.member_key === memberKey &&
              (row.status === DISMISSED || row.status === ACCEPTED)
          )

        const notes: string[] = []
        let created = 0
        let updated = 0
        let skipped = 0
        const detectedAt = new Date()

        for (const item of planned) {
          const { suggestion, memberKey, candidateKey, evidence } = item
          const cluster = {
            target_company_id: suggestion.targetCompanyId,
            source_company_ids: suggestion.sourceCompanyIds,
            names: suggestion.names,
            evidence: asJson(evidence),
            detected_at: detectedAt,
            folded_key: suggestion.foldedKey,
            member_key: memberKey
          }
          const candidateRow = pendingByCandidate.get(candidateKey)
          if (candidateRow && candidateRow.member_key === memberKey) {
            await tx.company_merge_suggestion.update({
              where: { id: candidateRow.id },
              data: cluster
            })
            updated += 1
            continue
          }
          if (candidateRow) {
            if (blocksMemberKey(memberKey)) {
              skipped += 1
              continue
            }
            const occupant = pendingByMember.get(memberKey)
            if (occupant && occupant.id !== candidateRow.id) {
              notes.push(
                `组合 ${memberKey} 已有待处理建议 #${occupant.id}，建议 #${candidateRow.id} 保持原成员`
              )
              skipped += 1
              continue
            }
            await tx.company_merge_pending_key.deleteMany({
              where: { suggestion_id: candidateRow.id }
            })
            await tx.company_merge_suggestion.update({
              where: { id: candidateRow.id },
              data: cluster
            })
            await tx.company_merge_pending_key.create({
              data: { member_key: memberKey, suggestion_id: candidateRow.id }
            })
            pendingByMember.delete(candidateRow.member_key)
            candidateRow.member_key = memberKey
            pendingByMember.set(memberKey, candidateRow)
            updated += 1
            continue
          }

          const occupant = pendingByMember.get(memberKey)
          if (occupant && occupant.candidate_key == null) {
            const taken = pendingByCandidate.get(candidateKey)
            await tx.company_merge_suggestion.update({
              where: { id: occupant.id },
              data: {
                ...cluster,
                ...(!taken || taken.id === occupant.id
                  ? { candidate_key: candidateKey }
                  : {})
              }
            })
            if (!taken || taken.id === occupant.id) {
              occupant.candidate_key = candidateKey
              pendingByCandidate.set(candidateKey, occupant)
            }
            updated += 1
            continue
          }
          if (occupant) {
            notes.push(
              `组合 ${memberKey} 已有待处理建议 #${occupant.id}，本次不新建`
            )
            skipped += 1
            continue
          }
          if (blocksMemberKey(memberKey)) {
            skipped += 1
            continue
          }

          const createdRow = await tx.company_merge_suggestion.create({
            data: {
              ...cluster,
              kind: suggestion.kind,
              status: PENDING,
              candidate_key: candidateKey
            }
          })
          await tx.company_merge_pending_key.create({
            data: { member_key: memberKey, suggestion_id: createdRow.id }
          })
          const queued: QueueRow = {
            id: createdRow.id,
            status: PENDING,
            member_key: memberKey,
            candidate_key: candidateKey
          }
          pendingByMember.set(memberKey, queued)
          pendingByCandidate.set(candidateKey, queued)
          created += 1
        }

        return { created, updated, skipped, notes }
      },
      { timeout: 60_000 }
    )
    const durationMs = Date.now() - started
    // eslint-disable-next-line no-console
    console.info(
      `[company-merges:detect] done ${durationMs}ms created=${written.created} updated=${written.updated} skipped=${earlySkipped + written.skipped}`
    )
    return {
      created: written.created,
      updated: written.updated,
      skipped: earlySkipped + written.skipped,
      durationMs,
      notes: [...earlyNotes, ...written.notes]
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[company-merges:detect] write failed:', error)
    return {
      created: 0,
      updated: 0,
      skipped: earlySkipped,
      durationMs: Date.now() - started,
      notes: [...earlyNotes, '建议写入失败，本次没有保存']
    }
  }
}

/**
 * Dismiss one pending row, record the operator, and free its pending-key.
 * The status guard stays in `updateMany` so two reviewers cannot both win.
 */
export const dismissCompanyMergeSuggestion = async (
  id: number,
  userId: number
): Promise<CompanyMergeDismissResponse | string> => {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockCompanyMergeQueue(tx)
      const existing = await tx.company_merge_suggestion.findUnique({
        where: { id },
        select: { id: true, status: true, member_key: true }
      })
      if (!existing) return '未找到该会社合并建议'
      if (existing.status !== PENDING) return '该建议已处理，无法重复驳回'
      await lockCompanyMergeSuggestionRows(tx, [existing.member_key])
      const updated = await tx.company_merge_suggestion.updateMany({
        where: { id, status: PENDING },
        data: {
          status: DISMISSED,
          resolved_at: new Date(),
          resolved_by_user_id: userId,
          resolution_source: 'operator-dismiss'
        }
      })
      if (updated.count === 0) return '该建议已处理，无法重复驳回'
      await tx.company_merge_pending_key.deleteMany({
        where: { suggestion_id: id }
      })
      return { id }
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[company-merges] dismiss failed:', error)
    return '驳回失败，请刷新列表后重试'
  }
}

/**
 * Put a dismissed row back to pending on the same id and insert its
 * pending-key. If that member_key is already held, the row stays dismissed.
 * Clears `resolution_source`. Does not touch companies.
 */
export const reopenCompanyMergeSuggestion = async (
  id: number
): Promise<CompanyMergeReopenResponse | string> => {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockCompanyMergeQueue(tx)
      const existing = await tx.company_merge_suggestion.findUnique({
        where: { id },
        select: { id: true, status: true, member_key: true }
      })
      if (!existing) return '未找到该会社合并建议'
      if (existing.status === PENDING) return '该建议仍待处理，无需重新打开'
      if (existing.status === ACCEPTED) return '该建议已合并，无法重新打开'
      if (existing.status !== DISMISSED) {
        return '该建议不是已驳回状态，无法重新打开'
      }
      await lockCompanyMergeSuggestionRows(tx, [existing.member_key])
      const taken = await tx.company_merge_pending_key.findUnique({
        where: { member_key: existing.member_key },
        select: { suggestion_id: true }
      })
      if (taken && taken.suggestion_id !== existing.id) {
        return '已有待处理的同一组会社'
      }
      const updated = await tx.company_merge_suggestion.updateMany({
        where: { id, status: DISMISSED },
        data: {
          status: PENDING,
          resolved_at: null,
          resolved_by_user_id: null,
          resolution_source: null
        }
      })
      if (updated.count === 0) return '该建议不是已驳回状态，无法重新打开'
      await tx.company_merge_pending_key.create({
        data: { member_key: existing.member_key, suggestion_id: existing.id }
      })
      return { id }
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) return '已有待处理的同一组会社'
    if (error instanceof CompanyMergeMemberKeyError) return error.message
    // eslint-disable-next-line no-console
    console.error('[company-merges] reopen failed:', error)
    return '重新打开失败，请刷新列表后重试'
  }
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
    // eslint-disable-next-line no-console
    console.error('Company merge cache invalidation failed:', error)
    return '合并已经写入数据库，但缓存失效失败：页面可能仍显示旧数据，请稍后重试。'
  }
}

/**
 * Apply the checked subset of one queued suggestion. The surviving company is
 * the smallest checked id. The client target is ignored. Owner is derived only
 * from the checked companies. Unchecked ids stay, and each is paired with the
 * survivor as a partial-merge exclusion in the same transaction.
 */
export const applyCompanyMergeSuggestion = async (
  input: {
    id: number
    name: string
    introductionFromCompanyId: number
    selectedCompanyIds: number[]
    targetCompanyId?: number
    ownerFromCompanyId?: number
  },
  userId: number
): Promise<CompanyMergeApplyResponse | string> => {
  const suggestion = await prisma.company_merge_suggestion.findFirst({
    where: { id: input.id, status: PENDING },
    select: {
      id: true,
      kind: true,
      target_company_id: true,
      source_company_ids: true,
      names: true,
      evidence: true,
      member_key: true
    }
  })
  if (!suggestion) {
    const existing = await prisma.company_merge_suggestion.findUnique({
      where: { id: input.id },
      select: { id: true }
    })
    return existing ? '该建议已处理，无法再次合并' : '未找到该会社合并建议'
  }

  const clusterIds = [
    ...new Set([
      suggestion.target_company_id,
      ...suggestion.source_company_ids
    ])
  ]
  let clusterKey: string
  try {
    clusterKey = toMemberKey(clusterIds)
  } catch (error) {
    if (error instanceof CompanyMergeMemberKeyError) return error.message
    throw error
  }
  const selected = [...new Set(input.selectedCompanyIds ?? [])].sort(
    (left, right) => left - right
  )
  if (selected.length < 2) return '至少选择两家会社'
  if (selected.some((companyId) => !clusterIds.includes(companyId))) {
    return '勾选的会社必须属于这条建议'
  }
  const targetCompanyId = selected[0]
  const sourceCompanyIds = selected.slice(1)
  if (!selected.includes(input.introductionFromCompanyId)) {
    return '介绍的来源必须是勾选的会社之一'
  }
  const unselectedIds = clusterIds.filter(
    (companyId) => !selected.includes(companyId)
  )
  let exclusionKeys: string[]
  try {
    exclusionKeys = unselectedIds.map((companyId) =>
      toMemberKey([targetCompanyId, companyId])
    )
  } catch (error) {
    if (error instanceof CompanyMergeMemberKeyError) return error.message
    throw error
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
        beforeCompanyLocks: async (tx) => {
          await lockCompanyMergeQueue(tx)
          const keys = new Set<string>([clusterKey, ...exclusionKeys])
          if (suggestion.member_key) keys.add(suggestion.member_key)
          await lockCompanyMergeSuggestionRows(tx, [...keys])
        },
        // 事务内重读整组 id。检测若已按 candidate_key 改过成员，与开头快照不同则回滚。
        beforeApply: async (tx) => {
          const locked = await tx.company_merge_suggestion.findFirst({
            where: { id: input.id, status: PENDING },
            select: { target_company_id: true, source_company_ids: true }
          })
          if (!locked) {
            throw new CompanyMergeApplyError('该建议已被处理，请刷新列表')
          }
          const lockedIds = [
            ...new Set([
              locked.target_company_id,
              ...locked.source_company_ids
            ])
          ]
          if (!sameIdSet(lockedIds, clusterIds)) {
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
              resolved_by_user_id: userId,
              resolution_source: 'operator-merge',
              selected_company_ids: selected,
              applied_source_company_ids: sourceCompanyIds,
              applied_target_company_id: targetCompanyId
            }
          })
          if (accepted.count === 0) {
            throw new CompanyMergeApplyError(
              '该建议已被他人处理，本次合并没有提交'
            )
          }
          await tx.company_merge_pending_key.deleteMany({
            where: { suggestion_id: input.id }
          })
          try {
            await writePartialMergeExclusions(tx, {
              parentId: suggestion.id,
              parentKind: suggestion.kind,
              parentNames: suggestion.names,
              parentTargetCompanyId: suggestion.target_company_id,
              parentSourceCompanyIds: suggestion.source_company_ids,
              parentEvidence: suggestion.evidence,
              survivorId: targetCompanyId,
              unselectedIds,
              resolvedByUserId: userId
            })
          } catch (error) {
            if (
              error instanceof CompanyMergeMemberKeyError ||
              (error instanceof Error && error.message === '会社合并证据无法写入')
            ) {
              throw new CompanyMergeApplyError(error.message)
            }
            throw error
          }
        }
      }
    })
  } catch (error) {
    if (error instanceof CompanyMergeApplyError) {
      return error.message
    }
    // eslint-disable-next-line no-console
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
