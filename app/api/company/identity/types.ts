import { z } from 'zod'
import {
  COMPANY_IDENTITY_VALUE_MAX_LENGTH,
  isCompanyIdentityValueWithinLimit,
  normalizeCompanyValue
} from './normalize'

export { COMPANY_IDENTITY_VALUE_MAX_LENGTH } from './normalize'

export const COMPANY_CANDIDATE_SOURCES = [
  'vndb',
  'bangumi',
  'steam',
  'dlsite'
] as const

export const COMPANY_CANDIDATE_MAX_PER_SOURCE = 50
export const COMPANY_CANDIDATE_MAX_ALIASES = 50
export const COMPANY_CANDIDATE_MAX_URLS = 50
const COMPANY_SOURCE_URL_MAX_LENGTH = 1007

export type CompanyCandidateSource = (typeof COMPANY_CANDIDATE_SOURCES)[number]

export const COMPANY_ROLES = [
  'developer',
  'publisher',
  'producer',
  'circle',
  'unknown'
] as const
export type CompanyRole = (typeof COMPANY_ROLES)[number]

export const COMPANY_ENTITY_TYPES = [
  'company',
  'individual',
  'amateur_group',
  'unknown'
] as const
export type CompanyEntityType = (typeof COMPANY_ENTITY_TYPES)[number]

const companyValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPANY_IDENTITY_VALUE_MAX_LENGTH)
  .refine(isCompanyIdentityValueWithinLimit)
const sourceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(COMPANY_SOURCE_URL_MAX_LENGTH)

export const companyCandidateSchema = z
  .object({
    source: z.enum(COMPANY_CANDIDATE_SOURCES),
    externalId: z.string().trim().max(COMPANY_IDENTITY_VALUE_MAX_LENGTH),
    name: companyValueSchema,
    aliases: z.array(companyValueSchema).max(COMPANY_CANDIDATE_MAX_ALIASES),
    roles: z.array(z.enum(COMPANY_ROLES)).max(COMPANY_ROLES.length),
    sourceRoles: z.array(companyValueSchema).max(COMPANY_CANDIDATE_MAX_ALIASES),
    entityType: z.enum(COMPANY_ENTITY_TYPES),
    externalUrls: z.array(sourceUrlSchema).max(COMPANY_CANDIDATE_MAX_URLS),
    primaryLanguage: z.string().trim().max(32),
    sourceWebsites: z.array(sourceUrlSchema).max(COMPANY_CANDIDATE_MAX_URLS)
  })
  .strict()

export type CompanyCandidate = z.infer<typeof companyCandidateSchema>

export const companyCandidateSnapshotSchema = z
  .object({
    lookupId: z.string().trim().min(1).max(COMPANY_IDENTITY_VALUE_MAX_LENGTH),
    fetchedAt: z.string().datetime(),
    candidates: z
      .array(companyCandidateSchema)
      .max(COMPANY_CANDIDATE_MAX_PER_SOURCE)
  })
  .strict()

export type CompanyCandidateSnapshot = z.infer<
  typeof companyCandidateSnapshotSchema
>

export type CompanyCandidateSnapshots = Record<
  CompanyCandidateSource,
  CompanyCandidateSnapshot | null
>

export type CompanyCandidateTrust = 'verified' | 'unverified'

export interface TrustedCompanyCandidate {
  trust: CompanyCandidateTrust
  candidate: CompanyCandidate
}

export type CompanyCandidateSourceState =
  | 'missing'
  | 'empty'
  | 'verified'
  | 'stale'
  | 'invalid'

export interface CompanyCandidateDiagnostic {
  source: CompanyCandidateSource
  reason: 'invalid-snapshot' | 'lookup-id-mismatch'
  lookupId?: string
  expectedLookupId?: string
}

export interface CompanyCandidateLookupIds {
  vndb: string | null | undefined
  bangumi: string | number | null | undefined
  steam: string | number | null | undefined
  dlsite: string | null | undefined
}

const emptySourceStates = (): Record<
  CompanyCandidateSource,
  CompanyCandidateSourceState
> => ({
  vndb: 'missing',
  bangumi: 'missing',
  steam: 'missing',
  dlsite: 'missing'
})

export const emptyCompanyCandidateSnapshots =
  (): CompanyCandidateSnapshots => ({
    vndb: null,
    bangumi: null,
    steam: null,
    dlsite: null
  })

export const normalizeCompanyCandidateLookupId = (
  source: CompanyCandidateSource,
  value: string | number | null | undefined
) => {
  const normalized = String(value ?? '').trim()
  if (source === 'vndb') return normalized.toLowerCase()
  if (source === 'dlsite') return normalized.toUpperCase()
  return normalized
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const mergeCompanyCandidateSnapshot = (
  raw: unknown,
  source: CompanyCandidateSource,
  snapshot: CompanyCandidateSnapshot
): Record<CompanyCandidateSource, unknown> => {
  const current = isRecord(raw) ? raw : {}
  return Object.fromEntries(
    COMPANY_CANDIDATE_SOURCES.map((candidateSource) => [
      candidateSource,
      candidateSource === source ? snapshot : (current[candidateSource] ?? null)
    ])
  ) as Record<CompanyCandidateSource, unknown>
}

/**
 * Trust is derived only at this database boundary. Stored JSON has no trust
 * bit that another writer could accidentally (or maliciously) promote.
 */
export const readVerifiedCompanyCandidates = (
  raw: unknown,
  lookupIds: CompanyCandidateLookupIds
) => {
  const candidates: TrustedCompanyCandidate[] = []
  const diagnostics: CompanyCandidateDiagnostic[] = []
  const sourceStates = emptySourceStates()

  if (raw == null) {
    return { candidates, diagnostics, sourceStates }
  }

  if (!isRecord(raw)) {
    for (const source of COMPANY_CANDIDATE_SOURCES) {
      sourceStates[source] = 'invalid'
      diagnostics.push({ source, reason: 'invalid-snapshot' })
    }
    return { candidates, diagnostics, sourceStates }
  }

  for (const source of COMPANY_CANDIDATE_SOURCES) {
    const slot = raw[source]
    if (slot == null) continue

    const parsed = companyCandidateSnapshotSchema.safeParse(slot)
    if (
      !parsed.success ||
      parsed.data.candidates.some((candidate) => candidate.source !== source)
    ) {
      sourceStates[source] = 'invalid'
      diagnostics.push({ source, reason: 'invalid-snapshot' })
      continue
    }

    const lookupId = normalizeCompanyCandidateLookupId(
      source,
      parsed.data.lookupId
    )
    const expectedLookupId = normalizeCompanyCandidateLookupId(
      source,
      lookupIds[source]
    )
    if (!expectedLookupId || lookupId !== expectedLookupId) {
      sourceStates[source] = 'stale'
      diagnostics.push({
        source,
        reason: 'lookup-id-mismatch',
        lookupId,
        expectedLookupId
      })
      continue
    }

    sourceStates[source] = parsed.data.candidates.length ? 'verified' : 'empty'
    candidates.push(
      ...parsed.data.candidates.map((candidate) => ({
        trust: 'verified' as const,
        candidate
      }))
    )
  }

  return { candidates, diagnostics, sourceStates }
}

export const createUnverifiedCompanyNameCandidates = (
  source: CompanyCandidateSource,
  names: string[],
  roles: CompanyRole[] = ['unknown']
): TrustedCompanyCandidate[] =>
  [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .filter(
      (name) =>
        name.length <= COMPANY_IDENTITY_VALUE_MAX_LENGTH &&
        isCompanyIdentityValueWithinLimit(name) &&
        Boolean(normalizeCompanyValue(name))
    )
    .map((name) => ({
      trust: 'unverified',
      candidate: {
        source,
        externalId: '',
        name,
        aliases: [],
        roles,
        sourceRoles: [],
        entityType: 'unknown',
        externalUrls: [],
        primaryLanguage: '',
        sourceWebsites: []
      }
    }))
