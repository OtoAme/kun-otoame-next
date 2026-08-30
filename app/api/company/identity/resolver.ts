import { Prisma } from '@prisma/client'
import { addPatchCompanyRelations } from '~/app/api/edit/companyRelationHelper'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'
import { normalizeCompanyValue } from './normalize'
import { syncCompanyIdentityProjection } from './projection'
import { normalizeCompanyCandidateLookupId } from './types'
import type {
  CompanyCandidate,
  CompanyCandidateSource,
  TrustedCompanyCandidate
} from './types'

export type CompanyResolutionMatchedBy =
  | 'external-id'
  | 'normalized-name'
  | 'normalized-alias'
  | 'batch'

export interface CompanyResolutionMatch {
  id: number
  name: string
}

export interface ResolvedCompany {
  candidates: TrustedCompanyCandidate[]
  companyId: number
  name: string
  matchedBy: CompanyResolutionMatchedBy
}

export interface CompanyAmbiguity {
  candidate: CompanyCandidate
  matchedCompanies: CompanyResolutionMatch[]
  reason: 'multiple-companies' | 'conflicting-external-id'
}

export interface CompanyResolutionDiagnostic {
  candidate: CompanyCandidate
  matchedCompanies: CompanyResolutionMatch[]
  reason: 'external-id-name-conflict'
}

export interface CompanyResolutionPlan {
  resolvedExisting: ResolvedCompany[]
  wouldCreate: TrustedCompanyCandidate[][]
  ambiguities: CompanyAmbiguity[]
  diagnostics: CompanyResolutionDiagnostic[]
}

export interface AppliedCompanyResolution {
  companyIds: number[]
  created: number
  insertedRelationIds: number[]
  diagnostics: CompanyResolutionDiagnostic[]
}

export type CompanyResolutionReadClient = Pick<
  Prisma.TransactionClient,
  'patch_company' | 'patch_company_external_id' | 'patch_company_name_identity'
>

interface CandidateEvidence {
  trusted: TrustedCompanyCandidate
  rank: number
  matchedBy: Exclude<CompanyResolutionMatchedBy, 'batch'> | null
  matches: CompanyResolutionMatch[]
  ambiguity?: CompanyAmbiguity
  diagnostic?: CompanyResolutionDiagnostic
}

const uniqueMatches = (matches: CompanyResolutionMatch[]) =>
  [...new Map(matches.map((match) => [match.id, match])).values()].sort(
    (left, right) => left.id - right.id
  )

const candidateRawValues = (candidate: CompanyCandidate) =>
  [
    ...new Set(
      [candidate.name, ...candidate.aliases].map((value) => value.trim())
    )
  ].filter(Boolean)

const candidateNormalizedValues = (candidate: CompanyCandidate) =>
  [...new Set(candidateRawValues(candidate).map(normalizeCompanyValue))].filter(
    Boolean
  )

const externalIdentityKey = (trusted: TrustedCompanyCandidate) => {
  if (trusted.trust !== 'verified' || !trusted.candidate.externalId.trim()) {
    return null
  }
  return `${trusted.candidate.source}\u0000${normalizeCompanyCandidateLookupId(
    trusted.candidate.source,
    trusted.candidate.externalId
  )}`
}

const intersects = (left: Set<string>, right: Set<string>) => {
  for (const value of left) {
    if (right.has(value)) return true
  }
  return false
}

const groupCandidateIndexes = (candidates: TrustedCompanyCandidate[]) => {
  const parent = candidates.map((_, index) => index)
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index])
    return parent[index]
  }
  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }
  const normalizedValues = candidates.map(
    (trusted) => new Set(candidateNormalizedValues(trusted.candidate))
  )
  const externalKeys = candidates.map(externalIdentityKey)

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (
        intersects(normalizedValues[left], normalizedValues[right]) ||
        (externalKeys[left] && externalKeys[left] === externalKeys[right])
      ) {
        union(left, right)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let index = 0; index < candidates.length; index += 1) {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), index])
  }
  return [...groups.values()]
}

const strongestNonExternalMatches = (input: {
  nameMatches: CompanyResolutionMatch[]
  authoritativeAliasMatches: CompanyResolutionMatch[]
  legacyAliasMatches: CompanyResolutionMatch[]
}) => {
  if (input.nameMatches.length) {
    return {
      rank: 3,
      matchedBy: 'normalized-name' as const,
      matches: input.nameMatches
    }
  }
  if (input.authoritativeAliasMatches.length) {
    return {
      rank: 2,
      matchedBy: 'normalized-alias' as const,
      matches: input.authoritativeAliasMatches
    }
  }
  if (input.legacyAliasMatches.length) {
    return {
      rank: 1,
      matchedBy: 'normalized-alias' as const,
      matches: input.legacyAliasMatches
    }
  }
  return { rank: 0, matchedBy: null, matches: [] }
}

const formatAmbiguityMessage = (ambiguities: CompanyAmbiguity[]) => {
  const details = ambiguities
    .slice(0, 10)
    .map((ambiguity) => {
      const candidate = `${ambiguity.candidate.source}:${ambiguity.candidate.name}`
      const matches = ambiguity.matchedCompanies
        .map((company) => `#${company.id} ${company.name}`)
        .join('、')
      return `${candidate} → ${matches}`
    })
    .join('；')
  return `会社身份存在歧义，需先由管理员完成会社身份维护：${details}`
}

export class CompanyResolutionAmbiguityError extends PatchSubmissionError {
  readonly ambiguities: CompanyAmbiguity[]

  constructor(ambiguities: CompanyAmbiguity[]) {
    super(formatAmbiguityMessage(ambiguities))
    this.name = 'CompanyResolutionAmbiguityError'
    this.ambiguities = ambiguities
  }
}

export const selectCanonicalCompanyName = (
  candidates: TrustedCompanyCandidate[]
) => {
  const verifiedVndb = candidates.filter(
    (trusted) =>
      trusted.trust === 'verified' && trusted.candidate.source === 'vndb'
  )
  for (const language of ['zh', 'ja']) {
    const native = verifiedVndb.find((trusted) =>
      trusted.candidate.primaryLanguage.toLowerCase().startsWith(language)
    )
    if (native) {
      return native.candidate.aliases[0] ?? native.candidate.name
    }
  }
  return verifiedVndb[0]?.candidate.name ?? candidates[0]?.candidate.name ?? ''
}

export const planCompanyResolution = async (
  db: CompanyResolutionReadClient,
  candidates: TrustedCompanyCandidate[]
): Promise<CompanyResolutionPlan> => {
  if (!candidates.length) {
    return {
      resolvedExisting: [],
      wouldCreate: [],
      ambiguities: [],
      diagnostics: []
    }
  }

  const normalizedValues = [
    ...new Set(
      candidates.flatMap((trusted) =>
        candidateNormalizedValues(trusted.candidate)
      )
    )
  ]
  const rawValues = [
    ...new Set(
      candidates.flatMap((trusted) => candidateRawValues(trusted.candidate))
    )
  ]
  const externalInputs = [
    ...new Map(
      candidates.flatMap((trusted) => {
        const key = externalIdentityKey(trusted)
        return key ? [[key, trusted] as const] : []
      })
    ).values()
  ]

  const [companies, identities, externalIdentities] = await Promise.all([
    db.patch_company.findMany({
      where: { normalized_name: { in: normalizedValues } },
      select: { id: true, name: true, normalized_name: true }
    }),
    db.patch_company_name_identity.findMany({
      where: {
        kind: 'alias',
        OR: [
          {
            origin: 'authoritative',
            normalized_value: { in: normalizedValues }
          },
          { origin: 'legacy', value: { in: rawValues } }
        ]
      },
      select: {
        origin: true,
        value: true,
        normalized_value: true,
        company: { select: { id: true, name: true } }
      }
    }),
    externalInputs.length
      ? db.patch_company_external_id.findMany({
          where: {
            OR: externalInputs.map((trusted) => ({
              source: trusted.candidate.source,
              external_id: normalizeCompanyCandidateLookupId(
                trusted.candidate.source,
                trusted.candidate.externalId
              )
            }))
          },
          select: {
            source: true,
            external_id: true,
            company: { select: { id: true, name: true } }
          }
        })
      : Promise.resolve([])
  ])

  const nameMatches = new Map<string, CompanyResolutionMatch[]>()
  for (const company of companies) {
    if (!company.normalized_name) continue
    nameMatches.set(company.normalized_name, [
      ...(nameMatches.get(company.normalized_name) ?? []),
      { id: company.id, name: company.name }
    ])
  }
  const authoritativeAliasMatches = new Map<string, CompanyResolutionMatch[]>()
  const legacyAliasMatches = new Map<string, CompanyResolutionMatch[]>()
  for (const identity of identities) {
    const map =
      identity.origin === 'authoritative'
        ? authoritativeAliasMatches
        : legacyAliasMatches
    const key =
      identity.origin === 'authoritative'
        ? identity.normalized_value
        : identity.value
    map.set(key, [
      ...(map.get(key) ?? []),
      { id: identity.company.id, name: identity.company.name }
    ])
  }
  const externalMatches = new Map<string, CompanyResolutionMatch[]>()
  for (const identity of externalIdentities) {
    const key = `${identity.source}\u0000${normalizeCompanyCandidateLookupId(
      identity.source as CompanyCandidateSource,
      identity.external_id
    )}`
    externalMatches.set(key, [
      ...(externalMatches.get(key) ?? []),
      { id: identity.company.id, name: identity.company.name }
    ])
  }

  const evidence: CandidateEvidence[] = candidates.map((trusted) => {
    const candidate = trusted.candidate
    const normalized = candidateNormalizedValues(candidate)
    const raw = candidateRawValues(candidate)
    const external = uniqueMatches(
      externalIdentityKey(trusted)
        ? (externalMatches.get(externalIdentityKey(trusted) as string) ?? [])
        : []
    )
    const byName = uniqueMatches(
      normalized.flatMap((value) => nameMatches.get(value) ?? [])
    )
    const byAuthoritativeAlias = uniqueMatches(
      normalized.flatMap((value) => authoritativeAliasMatches.get(value) ?? [])
    )
    const byLegacyAlias = uniqueMatches(
      raw.flatMap((value) => legacyAliasMatches.get(value) ?? [])
    )
    const nonExternal = strongestNonExternalMatches({
      nameMatches: byName,
      authoritativeAliasMatches: byAuthoritativeAlias,
      legacyAliasMatches: byLegacyAlias
    })

    if (external.length > 1) {
      return {
        trusted,
        rank: 4,
        matchedBy: 'external-id',
        matches: external,
        ambiguity: {
          candidate,
          matchedCompanies: external,
          reason: 'conflicting-external-id'
        }
      }
    }
    if (external.length === 1) {
      const conflicts = uniqueMatches(
        nonExternal.matches.filter((match) => match.id !== external[0].id)
      )
      return {
        trusted,
        rank: 4,
        matchedBy: 'external-id',
        matches: external,
        ...(conflicts.length
          ? {
              diagnostic: {
                candidate,
                matchedCompanies: uniqueMatches([...external, ...conflicts]),
                reason: 'external-id-name-conflict' as const
              }
            }
          : {})
      }
    }

    const matches = uniqueMatches(nonExternal.matches)
    return {
      trusted,
      rank: nonExternal.rank,
      matchedBy: nonExternal.matchedBy,
      matches,
      ...(matches.length > 1
        ? {
            ambiguity: {
              candidate,
              matchedCompanies: matches,
              reason: 'multiple-companies' as const
            }
          }
        : {})
    }
  })

  const resolvedExisting: ResolvedCompany[] = []
  const wouldCreate: TrustedCompanyCandidate[][] = []
  const ambiguities: CompanyAmbiguity[] = []
  const diagnostics: CompanyResolutionDiagnostic[] = evidence.flatMap((item) =>
    item.diagnostic ? [item.diagnostic] : []
  )

  for (const indexes of groupCandidateIndexes(candidates)) {
    const groupEvidence = indexes.map((index) => evidence[index])
    const strongestRank = Math.max(...groupEvidence.map((item) => item.rank))
    if (strongestRank === 0) {
      wouldCreate.push(groupEvidence.map((item) => item.trusted))
      continue
    }

    const strongest = groupEvidence.filter(
      (item) => item.rank === strongestRank
    )
    const strongestMatches = uniqueMatches(
      strongest.flatMap((item) => item.matches)
    )
    if (strongestMatches.length !== 1) {
      for (const item of strongest) {
        ambiguities.push({
          candidate: item.trusted.candidate,
          matchedCompanies: strongestMatches,
          reason:
            item.ambiguity?.reason === 'conflicting-external-id'
              ? 'conflicting-external-id'
              : 'multiple-companies'
        })
      }
      continue
    }

    const winner = strongestMatches[0]
    const hasBatchOnlyMember = groupEvidence.some(
      (item) => item.matches.length === 0
    )
    resolvedExisting.push({
      candidates: groupEvidence.map((item) => item.trusted),
      companyId: winner.id,
      name: winner.name,
      matchedBy: hasBatchOnlyMember
        ? 'batch'
        : (strongest[0].matchedBy ?? 'batch')
    })
  }

  return { resolvedExisting, wouldCreate, ambiguities, diagnostics }
}

const candidateKey = (candidate: CompanyCandidate) =>
  `${candidate.source}\u0000${candidate.externalId}\u0000${candidate.name}`

const verifiedEvidenceValues = (
  candidates: TrustedCompanyCandidate[],
  excluded: Set<string>,
  canonicalName: string
) => {
  const canonical = normalizeCompanyValue(canonicalName)
  const values = candidates.flatMap((trusted) => {
    if (
      trusted.trust !== 'verified' ||
      excluded.has(candidateKey(trusted.candidate))
    ) {
      return []
    }
    return candidateRawValues(trusted.candidate)
  })
  const byNormalized = new Map<string, string>()
  for (const value of values) {
    const normalized = normalizeCompanyValue(value)
    if (normalized !== canonical && !byNormalized.has(normalized)) {
      byNormalized.set(normalized, value)
    }
  }
  return [...byNormalized.values()]
}

const verifiedExternalIdentities = (candidates: TrustedCompanyCandidate[]) => {
  const identities = new Map<
    string,
    { source: CompanyCandidateSource; externalId: string }
  >()
  for (const trusted of candidates) {
    const key = externalIdentityKey(trusted)
    if (!key) continue
    identities.set(key, {
      source: trusted.candidate.source,
      externalId: normalizeCompanyCandidateLookupId(
        trusted.candidate.source,
        trusted.candidate.externalId
      )
    })
  }
  return [...identities.values()]
}

const applyExternalIdentities = async (
  tx: Prisma.TransactionClient,
  companyId: number,
  candidates: TrustedCompanyCandidate[]
) => {
  const desired = verifiedExternalIdentities(candidates)
  if (!desired.length) return

  const existing = await tx.patch_company_external_id.findMany({
    where: {
      OR: desired.map((identity) => ({
        source: identity.source,
        external_id: identity.externalId
      }))
    },
    select: { company_id: true, source: true, external_id: true }
  })
  const existingKeys = new Set(
    existing
      .filter((identity) => identity.company_id === companyId)
      .map((identity) => `${identity.source}\u0000${identity.external_id}`)
  )

  for (const identity of desired) {
    const key = `${identity.source}\u0000${identity.externalId}`
    if (existingKeys.has(key)) continue
    await tx.patch_company_external_id.create({
      data: {
        company_id: companyId,
        source: identity.source,
        external_id: identity.externalId
      }
    })
  }
}

const enrichExistingCompany = async (
  tx: Prisma.TransactionClient,
  resolution: ResolvedCompany,
  excluded: Set<string>
) => {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM patch_company WHERE id = ${resolution.companyId} FOR UPDATE`
  )
  const company = await tx.patch_company.findUnique({
    where: { id: resolution.companyId },
    select: { name: true, alias: true }
  })
  if (!company) throw new Error(`Company #${resolution.companyId} not found`)

  const verifiedAliases = verifiedEvidenceValues(
    resolution.candidates,
    excluded,
    company.name
  )
  const aliasByNormalized = new Map(
    company.alias.map((value) => [normalizeCompanyValue(value), value])
  )
  for (const alias of verifiedAliases) {
    const normalized = normalizeCompanyValue(alias)
    if (!aliasByNormalized.has(normalized)) {
      aliasByNormalized.set(normalized, alias)
    }
  }
  const nextAliases = [...aliasByNormalized.values()]
  if (
    nextAliases.length !== company.alias.length ||
    nextAliases.some((alias, index) => alias !== company.alias[index])
  ) {
    await tx.patch_company.update({
      where: { id: resolution.companyId },
      data: { alias: nextAliases }
    })
    await syncCompanyIdentityProjection(tx, {
      companyId: resolution.companyId
    })
  }
  if (verifiedAliases.length) {
    await tx.patch_company_name_identity.updateMany({
      where: {
        company_id: resolution.companyId,
        kind: 'alias',
        normalized_value: {
          in: verifiedAliases.map(normalizeCompanyValue)
        }
      },
      data: { origin: 'authoritative', confirmed_by_user_id: null }
    })
  }

  await applyExternalIdentities(tx, resolution.companyId, resolution.candidates)
}

const createResolvedCompany = async (
  tx: Prisma.TransactionClient,
  candidates: TrustedCompanyCandidate[],
  authorId: number
) => {
  const name = selectCanonicalCompanyName(candidates)
  const aliases = verifiedEvidenceValues(candidates, new Set(), name)
  const primaryLanguages = [
    ...new Set(
      candidates
        .map((trusted) => trusted.candidate.primaryLanguage.trim())
        .filter(Boolean)
    )
  ]
  const sourceWebsites = [
    ...new Set(
      candidates.flatMap((trusted) => trusted.candidate.sourceWebsites)
    )
  ]
  const company = await tx.patch_company.create({
    data: {
      name,
      normalized_name: normalizeCompanyValue(name),
      introduction: '',
      count: 0,
      primary_language: primaryLanguages,
      official_website: sourceWebsites,
      parent_brand: [],
      alias: aliases,
      user_id: authorId
    },
    select: { id: true, name: true }
  })
  await syncCompanyIdentityProjection(tx, {
    companyId: company.id,
    aliasOrigin: 'authoritative'
  })
  await applyExternalIdentities(tx, company.id, candidates)
  return company
}

export const applyCompanyResolution = async (
  tx: Prisma.TransactionClient,
  patchId: number,
  candidates: TrustedCompanyCandidate[],
  authorId: number
): Promise<AppliedCompanyResolution> => {
  const plan = await planCompanyResolution(tx, candidates)
  if (plan.ambiguities.length) {
    throw new CompanyResolutionAmbiguityError(plan.ambiguities)
  }

  const excluded = new Set(
    plan.diagnostics.map((diagnostic) => candidateKey(diagnostic.candidate))
  )
  for (const resolution of plan.resolvedExisting) {
    await enrichExistingCompany(tx, resolution, excluded)
  }

  const created: Array<{ id: number; name: string }> = []
  for (const group of plan.wouldCreate) {
    created.push(await createResolvedCompany(tx, group, authorId))
  }

  const companyIds = [
    ...new Set([
      ...plan.resolvedExisting.map((resolution) => resolution.companyId),
      ...created.map((company) => company.id)
    ])
  ]
  const insertedRelationIds = await addPatchCompanyRelations(
    tx,
    patchId,
    companyIds
  )
  return {
    companyIds,
    created: created.length,
    insertedRelationIds,
    diagnostics: plan.diagnostics
  }
}
