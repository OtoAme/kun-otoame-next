import { z } from 'zod'
import {
  COMPANY_MERGE_RESOLUTION_SOURCES,
  COMPANY_MERGE_SUGGESTION_STATUSES,
  type CompanyMergeEvidenceHit,
  type CompanyMergeResolutionSource
} from '~/types/api/companyMerges'

export const COMPANY_MERGE_KEY_MAX_LENGTH = 512

export class CompanyMergeMemberKeyError extends Error {
  readonly code: 'too-few' | 'too-long'

  constructor(code: 'too-few' | 'too-long') {
    super(
      code === 'too-few'
        ? '会社合并至少需要两家会社'
        : '会社组合键超过 512 字，无法写入'
    )
    this.name = 'CompanyMergeMemberKeyError'
    this.code = code
  }
}

const compareCodeUnit = (left: string, right: string) => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Sorted, de-duplicated company ids. This is the only identity detect uses to
 * skip a group. `folded_key` is display-only and must not be passed here.
 */
export const toMemberKey = (companyIds: readonly number[]) => {
  if (companyIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new CompanyMergeMemberKeyError('too-few')
  }
  const unique = [...new Set(companyIds)].sort((left, right) => left - right)
  if (unique.length < 2) {
    throw new CompanyMergeMemberKeyError('too-few')
  }
  const key = unique.join(',')
  if (key.length > COMPANY_MERGE_KEY_MAX_LENGTH) {
    throw new CompanyMergeMemberKeyError('too-long')
  }
  return key
}

/**
 * Source-pair keys stay put when the member set changes
 * (`source-pair|<sorted upstream ids>|patch:<id>`). Every other kind embeds
 * `toMemberKey`, so a different member set is a different suggestion.
 * Upstream ids sort by UTF-16 code unit, which matches UTF-8 byte order for
 * the BMP strings these ids use.
 */
export const toCandidateKey = (input: {
  kind: string
  companyIds: readonly number[]
  upstreamIds?: readonly string[]
  patchId?: number | null
}) => {
  if (input.kind === 'source-pair') {
    const upstreamIds = [
      ...new Set(
        (input.upstreamIds ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    ].sort(compareCodeUnit)
    if (
      upstreamIds.length === 0 ||
      input.patchId == null ||
      !Number.isInteger(input.patchId) ||
      input.patchId <= 0
    ) {
      throw new CompanyMergeMemberKeyError('too-few')
    }
    const key = `source-pair|${upstreamIds.join(',')}|patch:${input.patchId}`
    if (key.length > COMPANY_MERGE_KEY_MAX_LENGTH) {
      throw new CompanyMergeMemberKeyError('too-long')
    }
    return key
  }

  const key = `${input.kind}|${toMemberKey(input.companyIds)}`
  if (key.length > COMPANY_MERGE_KEY_MAX_LENGTH) {
    throw new CompanyMergeMemberKeyError('too-long')
  }
  return key
}

const companyMergeHitSchema = z.discriminatedUnion('source', [
  z.object({
    companyId: z.number().int().positive(),
    source: z.literal('vndb'),
    field: z.enum(['name', 'original', 'alias']),
    value: z.string().trim().min(1).max(500)
  }),
  z.object({
    companyId: z.number().int().positive(),
    source: z.literal('nextmoe'),
    field: z.literal('display_name'),
    value: z.string().trim().min(1).max(500)
  })
])

const laterPartialMergeExclusionSchema = z.object({
  parentSuggestionId: z.number().int().positive(),
  memberKey: z.string().trim().min(1).max(COMPANY_MERGE_KEY_MAX_LENGTH),
  patchId: z.number().int().positive().nullable().optional(),
  upstreamIds: z.array(z.string()).optional(),
  at: z.string().trim().min(1).max(40)
})

export const companyMergeEvidenceSchema = (memberIds: readonly number[]) => {
  const allowed = new Set(memberIds)
  return z
    .object({
      hits: z.array(companyMergeHitSchema).superRefine((hits, context) => {
        hits.forEach((hit, index) => {
          if (!allowed.has(hit.companyId)) {
            context.addIssue({
              code: 'custom',
              message: '证据里的会社不属于该建议',
              path: [index, 'companyId']
            })
          }
        })
      }),
      kind: z.string().trim().min(1).max(32).optional(),
      foldedKey: z.string().trim().min(1).max(107).optional(),
      patchId: z.number().int().positive().optional(),
      upstreamIds: z.array(z.string().trim().min(1).max(200)).optional(),
      bag: z.array(z.string()).optional(),
      resolutionSource: z.enum(COMPANY_MERGE_RESOLUTION_SOURCES).optional(),
      parentSuggestionId: z.number().int().positive().optional(),
      laterPartialMergeExclusions: z
        .array(laterPartialMergeExclusionSchema)
        .optional()
    })
    .strict()
}

export const assertCompanyMergeEvidence = (
  evidence: unknown,
  memberIds: readonly number[]
) => {
  const parsed = companyMergeEvidenceSchema(memberIds).safeParse(evidence)
  if (!parsed.success) {
    throw new Error('会社合并证据无法写入')
  }
  return parsed.data
}

/** Invalid or legacy evidence becomes an empty hit list. Never throws. */
export const parseCompanyMergeEvidenceHits = (
  evidence: unknown,
  memberIds: readonly number[]
): CompanyMergeEvidenceHit[] => {
  const parsed = companyMergeEvidenceSchema(memberIds).safeParse(evidence)
  return parsed.success ? parsed.data.hits : []
}

export const readStoredCompanyIds = (
  value: unknown,
  minimum: number
): number[] | null => {
  if (value == null) return null
  const parsed = z.array(z.number().int().positive()).min(minimum).safeParse(value)
  return parsed.success ? parsed.data : null
}

export const readResolutionSource = (
  value: unknown
): CompanyMergeResolutionSource | null => {
  const parsed = z.enum(COMPANY_MERGE_RESOLUTION_SOURCES).safeParse(value)
  return parsed.success ? parsed.data : null
}

export const listCompanyMergeSuggestionsSchema = z.object({
  status: z
    .enum(COMPANY_MERGE_SUGGESTION_STATUSES, {
      message: '状态必须是 pending、dismissed 或 accepted'
    })
    .default('pending')
})

export const dismissCompanyMergeSuggestionSchema = z.object({
  id: z.coerce.number().int().min(1).max(9999999)
})

export const reopenCompanyMergeSuggestionSchema =
  dismissCompanyMergeSuggestionSchema

const companyId = z.coerce.number().int().min(1).max(9999999)

export const applyCompanyMergeSuggestionSchema = z.object({
  id: z.coerce.number().int().min(1).max(9999999),
  // 主会社由勾选 id 的最小值决定，客户端传了也会被忽略。
  targetCompanyId: companyId.optional(),
  selectedCompanyIds: z.array(companyId).min(2).max(100),
  // 主名必须是某个勾选会社的名称或别名，服务端会在事务内再核一次。
  name: z.string().trim().min(1).max(107),
  // 记录所有者只从勾选会社按主名推导，客户端传了也会被忽略。
  ownerFromCompanyId: companyId.optional(),
  introductionFromCompanyId: companyId
})
