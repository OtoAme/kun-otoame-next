import type { Prisma } from '@prisma/client'
import {
  assertCompanyMergeEvidence,
  companyMergeEvidenceSchema,
  parseCompanyMergeEvidenceHits,
  toMemberKey
} from '~/validations/companyMerges'
import type { CompanyMergeEvidenceHit } from '~/types/api/companyMerges'

const DISMISSED = 'dismissed'
const PENDING = 'pending'
const ACCEPTED = 'accepted'
const PARTIAL = 'partial-merge-exclusion'

type SuggestionRow = {
  id: number
  status: string
  kind: string
  names: string[]
  evidence: Prisma.JsonValue
  resolution_source: string | null
  resolved_at: Date | null
  resolved_by_user_id: number | null
  candidate_key: string | null
  member_key: string
  target_company_id: number
  source_company_ids: number[]
  folded_key: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readParentSource = (evidence: unknown, memberIds: readonly number[]) => {
  if (!isRecord(evidence)) {
    return {
      patchId: undefined as number | undefined,
      upstreamIds: undefined as string[] | undefined,
      hits: [] as CompanyMergeEvidenceHit[]
    }
  }
  const patchId =
    typeof evidence.patchId === 'number' &&
    Number.isInteger(evidence.patchId) &&
    evidence.patchId > 0
      ? evidence.patchId
      : undefined
  const upstreamIds = Array.isArray(evidence.upstreamIds)
    ? evidence.upstreamIds.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      )
    : undefined
  return {
    patchId,
    upstreamIds,
    hits: parseCompanyMergeEvidenceHits(evidence, memberIds)
  }
}

const exclusionEvidence = (input: {
  parentId: number
  memberIds: number[]
  parentEvidence: unknown
  parentMemberIds: number[]
}) => {
  const source = readParentSource(input.parentEvidence, input.parentMemberIds)
  const allowed = new Set(input.memberIds)
  return assertCompanyMergeEvidence(
    {
      hits: source.hits.filter((hit) => allowed.has(hit.companyId)),
      resolutionSource: PARTIAL,
      parentSuggestionId: input.parentId,
      ...(source.patchId ? { patchId: source.patchId } : {}),
      ...(source.upstreamIds ? { upstreamIds: source.upstreamIds } : {})
    },
    input.memberIds
  )
}

const appendLaterExclusion = (input: {
  evidence: unknown
  memberIds: number[]
  parentId: number
  memberKey: string
  parentEvidence: unknown
  parentMemberIds: number[]
}) => {
  const current = isRecord(input.evidence) ? input.evidence : {}
  const source = readParentSource(input.parentEvidence, input.parentMemberIds)
  const previousEvents = Array.isArray(current.laterPartialMergeExclusions)
    ? current.laterPartialMergeExclusions.filter(isRecord)
    : []
  const event = {
    parentSuggestionId: input.parentId,
    memberKey: input.memberKey,
    patchId: source.patchId ?? null,
    upstreamIds: source.upstreamIds ?? [],
    at: new Date().toISOString()
  }
  const next: Record<string, unknown> = {
    hits: parseCompanyMergeEvidenceHits(
      { hits: Array.isArray(current.hits) ? current.hits : [] },
      input.memberIds
    ),
    laterPartialMergeExclusions: [...previousEvents, event]
  }
  if (typeof current.kind === 'string') next.kind = current.kind
  if (typeof current.foldedKey === 'string') next.foldedKey = current.foldedKey
  if (typeof current.patchId === 'number') next.patchId = current.patchId
  if (Array.isArray(current.upstreamIds)) next.upstreamIds = current.upstreamIds
  if (Array.isArray(current.bag)) next.bag = current.bag
  if (
    current.resolutionSource === 'operator-dismiss' ||
    current.resolutionSource === 'operator-merge' ||
    current.resolutionSource === 'partial-merge-exclusion'
  ) {
    next.resolutionSource = current.resolutionSource
  }
  if (typeof current.parentSuggestionId === 'number') {
    next.parentSuggestionId = current.parentSuggestionId
  }
  const parsed = companyMergeEvidenceSchema(input.memberIds).safeParse(next)
  if (parsed.success) return parsed.data
  return assertCompanyMergeEvidence(
    {
      hits: [],
      laterPartialMergeExclusions: [event]
    },
    input.memberIds
  )
}

const pairIds = (survivorId: number, unselectedId: number) =>
  [survivorId, unselectedId].sort((left, right) => left - right)

const frozenNames = (
  parentIds: number[],
  parentNames: string[],
  ids: number[]
) => {
  const nameById = new Map<number, string>()
  parentIds.forEach((id, index) => {
    const name = parentNames[index]
    if (name) nameById.set(id, name)
  })
  return ids.map((id) => nameById.get(id) ?? `#${id}`)
}

const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue

/**
 * One dismissed row per unchecked company, paired with the surviving id.
 * Caller holds the company-merge advisory lock and has already locked these
 * member keys. Does not insert a second row when any row already uses the key.
 */
export const writePartialMergeExclusions = async (
  tx: Prisma.TransactionClient,
  input: {
    parentId: number
    parentKind: string
    parentNames: string[]
    parentTargetCompanyId: number
    parentSourceCompanyIds: number[]
    parentEvidence: unknown
    survivorId: number
    unselectedIds: number[]
    resolvedByUserId: number
  }
) => {
  const parentIds = [
    input.parentTargetCompanyId,
    ...input.parentSourceCompanyIds
  ]
  for (const unselectedId of [...new Set(input.unselectedIds)].sort(
    (left, right) => left - right
  )) {
    const ids = pairIds(input.survivorId, unselectedId)
    const memberKey = toMemberKey(ids)
    const rows = (await tx.company_merge_suggestion.findMany({
      where: { member_key: memberKey },
      select: {
        id: true,
        status: true,
        kind: true,
        names: true,
        evidence: true,
        resolution_source: true,
        resolved_at: true,
        resolved_by_user_id: true,
        candidate_key: true,
        member_key: true,
        target_company_id: true,
        source_company_ids: true,
        folded_key: true
      }
    })) as SuggestionRow[]

    if (rows.some((row) => row.status === ACCEPTED)) {
      // eslint-disable-next-line no-console
      console.error(
        `[company-merges] skip auto-exclude member_key=${memberKey} already accepted`
      )
      continue
    }

    const evidence = exclusionEvidence({
      parentId: input.parentId,
      memberIds: ids,
      parentEvidence: input.parentEvidence,
      parentMemberIds: parentIds
    })
    const pending = rows.find((row) => row.status === PENDING)
    if (pending) {
      await tx.company_merge_suggestion.update({
        where: { id: pending.id },
        data: {
          status: DISMISSED,
          resolution_source: PARTIAL,
          candidate_key: null,
          resolved_at: new Date(),
          resolved_by_user_id: input.resolvedByUserId,
          evidence: asJson(evidence)
        }
      })
      await tx.company_merge_pending_key.deleteMany({
        where: { suggestion_id: pending.id }
      })
      continue
    }

    const manual = rows.find(
      (row) =>
        row.status === DISMISSED && row.resolution_source !== PARTIAL
    )
    if (manual) {
      const appended = appendLaterExclusion({
        evidence: manual.evidence,
        memberIds: ids,
        parentId: input.parentId,
        memberKey,
        parentEvidence: input.parentEvidence,
        parentMemberIds: parentIds
      })
      await tx.company_merge_suggestion.update({
        where: { id: manual.id },
        data: { evidence: asJson(appended) }
      })
      continue
    }

    const automatic = rows.find(
      (row) =>
        row.status === DISMISSED && row.resolution_source === PARTIAL
    )
    if (automatic) {
      const current = isRecord(automatic.evidence) ? automatic.evidence : {}
      const next = {
        hits: parseCompanyMergeEvidenceHits(
          { hits: Array.isArray(current.hits) ? current.hits : [] },
          ids
        ),
        resolutionSource: PARTIAL,
        parentSuggestionId: input.parentId,
        ...(typeof current.kind === 'string' ? { kind: current.kind } : {}),
        ...(typeof current.foldedKey === 'string'
          ? { foldedKey: current.foldedKey }
          : {}),
        ...(typeof current.patchId === 'number'
          ? { patchId: current.patchId }
          : {}),
        ...(Array.isArray(current.upstreamIds)
          ? { upstreamIds: current.upstreamIds }
          : {}),
        ...(Array.isArray(current.bag) ? { bag: current.bag } : {}),
        ...(Array.isArray(current.laterPartialMergeExclusions)
          ? { laterPartialMergeExclusions: current.laterPartialMergeExclusions }
          : {})
      }
      const parsed = companyMergeEvidenceSchema(ids).safeParse(next)
      await tx.company_merge_suggestion.update({
        where: { id: automatic.id },
        data: {
          evidence: asJson(
            parsed.success
              ? parsed.data
              : assertCompanyMergeEvidence(
                  {
                    hits: [],
                    resolutionSource: PARTIAL,
                    parentSuggestionId: input.parentId
                  },
                  ids
                )
          )
        }
      })
      continue
    }

    const targetCompanyId = ids[0]
    const sourceCompanyIds = ids.slice(1)
    await tx.company_merge_suggestion.create({
      data: {
        kind: input.parentKind,
        status: DISMISSED,
        folded_key: '',
        target_company_id: targetCompanyId,
        source_company_ids: sourceCompanyIds,
        names: frozenNames(parentIds, input.parentNames, ids),
        evidence: asJson(evidence),
        member_key: memberKey,
        candidate_key: null,
        resolution_source: PARTIAL,
        resolved_at: new Date(),
        resolved_by_user_id: input.resolvedByUserId,
        detected_at: new Date()
      }
    })
  }
}
