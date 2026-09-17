import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { buildAutoAliasCompanyMergePlan } from './companyMergePlan'
import type {
  TrustedCompanyCandidate,
  CompanyCandidateSource
} from '~/app/api/company/identity/types'
import type { MergeCompaniesPlan } from './companyMergePlan'

export interface MaintenanceCompanyIdentity {
  kind: string
  origin: string
  value: string
  normalizedValue: string
}

export interface MaintenanceCompanyExternalId {
  source: string
  externalId: string
}

export interface MaintenanceCompany {
  id: number
  name: string
  normalizedName: string | null
  count: number
  alias: string[]
  identities: MaintenanceCompanyIdentity[]
  externalIds: MaintenanceCompanyExternalId[]
}

export interface CompanyIdentityCollisionGroup {
  value: string
  companies: { id: number; name: string }[]
}

export interface CompanyAliasNameCollision {
  aliasCompany: { id: number; name: string }
  nameCompany: { id: number; name: string }
  alias: string
  normalizedValue: string
  origin: string
}

export interface CompanyIdentityInventory {
  normalizedNameCollisions: CompanyIdentityCollisionGroup[]
  aliasNameCollisions: CompanyAliasNameCollision[]
  sharedAliases: CompanyIdentityCollisionGroup[]
  externalIdConflicts: CompanyIdentityCollisionGroup[]
  missingNormalizedNames: { id: number; name: string }[]
  legacyAliasCount: number
}

export interface CompanyVndbEvidenceInput {
  company: MaintenanceCompany
  candidates: TrustedCompanyCandidate[]
}

/**
 * A NextMoe catalog company already matched to a local company. NextMoe has no
 * slot in `COMPANY_CANDIDATE_SOURCES`, so evidence planning takes this local
 * shape instead of a `TrustedCompanyCandidate`.
 */
export interface CompanyNextmoeEvidenceCandidate {
  /** Local `patch_company.id` the catalog company was matched to. */
  companyId: number
  /** NextMoe catalog company id, stored as the external id. */
  externalId: string
  /** NextMoe `display_name`, preferred when a canonical company must be chosen. */
  displayName: string
  /** Catalog alias values with machine aliases and over-long values removed. */
  values: string[]
}

export interface CompanyNextmoeEvidenceInput {
  companies: MaintenanceCompany[]
  candidates: CompanyNextmoeEvidenceCandidate[]
}

export interface CompanyAuthoritativeEvidencePlan {
  companyId: number
  source: CompanyCandidateSource | 'nextmoe'
  externalId: string
  authoritativeValues: string[]
}

export interface CompanyEvidencePlan {
  actions: CompanyAuthoritativeEvidencePlan[]
  warnings: string[]
}

const companyRef = (company: MaintenanceCompany) => ({
  id: company.id,
  name: company.name
})

const groupCompaniesBy = (
  companies: MaintenanceCompany[],
  value: (company: MaintenanceCompany) => string | null
) => {
  const groups = new Map<string, MaintenanceCompany[]>()
  for (const company of companies) {
    const key = value(company)
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), company])
  }
  return groups
}

export const buildCompanyIdentityInventory = (
  companies: MaintenanceCompany[]
): CompanyIdentityInventory => {
  const namesByNormalized = groupCompaniesBy(
    companies,
    (company) => company.normalizedName
  )
  const normalizedNameCollisions = [...namesByNormalized.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([value, owners]) => ({
      value,
      companies: owners.map(companyRef)
    }))

  const aliasNameCollisions: CompanyAliasNameCollision[] = []
  const aliasesByNormalized = new Map<
    string,
    Array<{ company: MaintenanceCompany; identity: MaintenanceCompanyIdentity }>
  >()
  let legacyAliasCount = 0
  for (const company of companies) {
    for (const identity of company.identities) {
      if (identity.kind !== 'alias') continue
      if (identity.origin === 'legacy') legacyAliasCount += 1
      aliasesByNormalized.set(identity.normalizedValue, [
        ...(aliasesByNormalized.get(identity.normalizedValue) ?? []),
        { company, identity }
      ])
      for (const nameOwner of namesByNormalized.get(identity.normalizedValue) ??
        []) {
        if (nameOwner.id === company.id) continue
        aliasNameCollisions.push({
          aliasCompany: companyRef(company),
          nameCompany: companyRef(nameOwner),
          alias: identity.value,
          normalizedValue: identity.normalizedValue,
          origin: identity.origin
        })
      }
    }
  }

  const sharedAliases = [...aliasesByNormalized.entries()]
    .map(([value, owners]) => ({
      value,
      companies: [
        ...new Map(
          owners.map(({ company }) => [company.id, companyRef(company)])
        ).values()
      ]
    }))
    .filter((group) => group.companies.length > 1)

  const externalOwners = new Map<string, MaintenanceCompany[]>()
  for (const company of companies) {
    for (const identity of company.externalIds) {
      const key = `${identity.source}\u0000${identity.externalId}`
      externalOwners.set(key, [...(externalOwners.get(key) ?? []), company])
    }
  }
  const externalIdConflicts = [...externalOwners.entries()]
    .map(([value, owners]) => ({
      value: value.replace('\u0000', ':'),
      companies: [
        ...new Map(
          owners.map((company) => [company.id, companyRef(company)])
        ).values()
      ]
    }))
    .filter((group) => group.companies.length > 1)

  return {
    normalizedNameCollisions,
    aliasNameCollisions,
    sharedAliases,
    externalIdConflicts,
    missingNormalizedNames: companies
      .filter((company) => !company.normalizedName)
      .map(companyRef),
    legacyAliasCount
  }
}

const candidateValues = (trusted: TrustedCompanyCandidate) => [
  ...new Map(
    [trusted.candidate.name, ...trusted.candidate.aliases]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => [normalizeCompanyValue(value), value])
  ).values()
]

/** Deduplicates values by normalized form, keeping the last original spelling. */
const unionNormalizedValues = (...groups: string[][]) => [
  ...new Map(
    groups.flat().map((value) => [normalizeCompanyValue(value), value])
  ).values()
]

interface NamedEvidenceCandidate {
  externalId: string
  values: string[]
}

interface MatchedEvidenceCandidate<Candidate extends NamedEvidenceCandidate> {
  externalId: string
  values: string[]
  candidate: Candidate
}

/**
 * Shared by every authoritative evidence source: a company keeps only values
 * whose normalized form equals its reviewed main name, and values arriving
 * under the same external id are unioned into one proposal.
 */
const matchEvidenceCandidates = <Candidate extends NamedEvidenceCandidate>(
  company: MaintenanceCompany,
  candidates: Candidate[]
) => {
  const matching = new Map<string, MatchedEvidenceCandidate<Candidate>>()
  for (const candidate of candidates) {
    if (
      !candidate.values.some(
        (value) => normalizeCompanyValue(value) === company.normalizedName
      )
    ) {
      continue
    }
    const current = matching.get(candidate.externalId)
    matching.set(candidate.externalId, {
      externalId: candidate.externalId,
      values: unionNormalizedValues(current?.values ?? [], candidate.values),
      candidate
    })
  }
  return matching
}

export const planAuthoritativeVndbCompanyEvidence = (
  inputs: CompanyVndbEvidenceInput[]
): CompanyEvidencePlan => {
  const provisional: CompanyAuthoritativeEvidencePlan[] = []
  const warnings: string[] = []

  for (const { company, candidates } of inputs) {
    if (!company.normalizedName) {
      warnings.push(
        `Skip #${company.id} ${company.name}: normalized_name is missing`
      )
      continue
    }
    const matching = new Map<string, { values: string[] }>()
    for (const [externalId, matched] of matchEvidenceCandidates(
      company,
      candidates
        .filter(
          (trusted) =>
            trusted.trust === 'verified' &&
            trusted.candidate.source === 'vndb' &&
            Boolean(trusted.candidate.externalId.trim())
        )
        .map((trusted) => ({
          externalId: trusted.candidate.externalId.trim().toLowerCase(),
          values: candidateValues(trusted)
        }))
    )) {
      const key = `vndb\u0000${externalId}`
      matching.set(key, matched)
    }

    if (matching.size > 1) {
      warnings.push(
        `Skip #${company.id} ${company.name}: main name matches multiple VNDB producers ${[
          ...matching.keys()
        ]
          .map((key) => key.split('\u0000')[1])
          .join(', ')}`
      )
      continue
    }
    const evidence = [...matching.entries()][0]
    if (!evidence) continue
    const [key, matched] = evidence
    const externalId = key.split('\u0000')[1]
    const existingVndbIds = [
      ...new Set(
        company.externalIds
          .filter((identity) => identity.source === 'vndb')
          .map((identity) => identity.externalId.toLowerCase())
      )
    ]
    if (existingVndbIds.length > 0 && !existingVndbIds.includes(externalId)) {
      warnings.push(
        `Skip #${company.id} ${company.name}: existing VNDB producer ${existingVndbIds.join(', ')} conflicts with ${externalId}`
      )
      continue
    }

    const existingAuthoritativeValues = new Set(
      company.identities
        .filter(
          (identity) =>
            identity.origin === 'authoritative' &&
            (identity.kind === 'name' || identity.kind === 'alias')
        )
        .map((identity) => identity.normalizedValue)
    )
    const alreadyHasExternalId = existingVndbIds.includes(externalId)
    const alreadyHasAuthoritativeProjection = matched.values.every((value) =>
      existingAuthoritativeValues.has(normalizeCompanyValue(value))
    )
    if (alreadyHasExternalId && alreadyHasAuthoritativeProjection) {
      continue
    }
    provisional.push({
      companyId: company.id,
      source: 'vndb',
      externalId,
      authoritativeValues: matched.values
    })
  }

  const ownersByExternalId = new Map<
    string,
    CompanyAuthoritativeEvidencePlan[]
  >()
  for (const action of provisional) {
    const key = `${action.source}\u0000${action.externalId}`
    ownersByExternalId.set(key, [
      ...(ownersByExternalId.get(key) ?? []),
      action
    ])
  }

  const storedOwnerIdsByExternalId = new Map<string, Set<number>>()
  for (const input of inputs) {
    for (const identity of input.company.externalIds) {
      const key = `${identity.source}\u0000${identity.externalId.toLowerCase()}`
      const owners = storedOwnerIdsByExternalId.get(key) ?? new Set<number>()
      owners.add(input.company.id)
      storedOwnerIdsByExternalId.set(key, owners)
    }
  }
  const conflictingCompanyIds = new Set<number>()
  for (const [key, actions] of ownersByExternalId) {
    const companyIds = [
      ...new Set([
        ...(storedOwnerIdsByExternalId.get(key) ?? []),
        ...actions.map((action) => action.companyId)
      ])
    ]
    if (companyIds.length < 2) continue
    actions.forEach((action) => conflictingCompanyIds.add(action.companyId))
    warnings.push(
      `Do not bind ${key.replace('\u0000', ':')}: evidence points to companies ${companyIds.map((id) => `#${id}`).join(', ')}; choose a canonical company manually`
    )
  }

  return {
    actions: provisional.filter(
      (action) => !conflictingCompanyIds.has(action.companyId)
    ),
    warnings
  }
}

type ProvisionalNextmoeAction = CompanyAuthoritativeEvidencePlan & {
  displayName: string
}

const matchesNextmoeDisplayName = (
  company: MaintenanceCompany | undefined,
  action: ProvisionalNextmoeAction
) =>
  Boolean(company?.normalizedName) &&
  company?.normalizedName === normalizeCompanyValue(action.displayName)

const pickNextmoeCanonicalCompany = (
  actions: ProvisionalNextmoeAction[],
  companiesById: Map<number, MaintenanceCompany>
) =>
  [...actions].sort((left, right) => {
    const leftCompany = companiesById.get(left.companyId)
    const rightCompany = companiesById.get(right.companyId)
    const countDifference =
      (rightCompany?.count ?? 0) - (leftCompany?.count ?? 0)
    if (countDifference !== 0) return countDifference
    const displayNameDifference =
      Number(matchesNextmoeDisplayName(rightCompany, right)) -
      Number(matchesNextmoeDisplayName(leftCompany, left))
    if (displayNameDifference !== 0) return displayNameDifference
    return left.companyId - right.companyId
  })[0]

/**
 * Applying the action would change nothing: the catalog id is already stored
 * and every value is the reviewed main name or an authoritative identity.
 * Same convergence rule the VNDB path uses, so a re-planned database stays
 * free of repeated evidence actions.
 */
const isNextmoeEvidenceProjected = (
  company: MaintenanceCompany,
  externalId: string,
  values: string[]
) => {
  if (
    !company.externalIds.some(
      (identity) =>
        identity.source === 'nextmoe' && identity.externalId === externalId
    )
  ) {
    return false
  }
  const projected = new Set<string | null>([
    company.normalizedName,
    ...company.identities
      .filter(
        (identity) =>
          identity.origin === 'authoritative' &&
          (identity.kind === 'name' || identity.kind === 'alias')
      )
      .map((identity) => identity.normalizedValue)
  ])
  return values.every((value) => projected.has(normalizeCompanyValue(value)))
}

/**
 * NextMoe evidence resolves its own conflicts instead of deferring to an
 * operator: a catalog company is a single identity, so the local company that
 * already stores it — or the best-supported match — wins outright and the
 * remaining proposals only contribute alias values.
 */
export const planAuthoritativeNextmoeCompanyEvidence = (
  input: CompanyNextmoeEvidenceInput
): CompanyEvidencePlan => {
  const warnings: string[] = []
  const companiesById = new Map(
    input.companies.map((company) => [company.id, company])
  )
  const candidatesByCompany = new Map<
    number,
    CompanyNextmoeEvidenceCandidate[]
  >()
  for (const candidate of input.candidates) {
    candidatesByCompany.set(candidate.companyId, [
      ...(candidatesByCompany.get(candidate.companyId) ?? []),
      candidate
    ])
  }

  const provisional: ProvisionalNextmoeAction[] = []
  const companyIds = [...candidatesByCompany.keys()].sort(
    (left, right) => left - right
  )
  for (const companyId of companyIds) {
    const company = companiesById.get(companyId)
    if (!company) continue
    if (!company.normalizedName) {
      warnings.push(
        `Skip #${company.id} ${company.name}: normalized_name is missing`
      )
      continue
    }
    const matching = matchEvidenceCandidates(
      company,
      candidatesByCompany.get(companyId) ?? []
    )
    if (matching.size > 1) {
      warnings.push(
        `Skip #${company.id} ${company.name}: main name matches multiple NextMoe companies ${[
          ...matching.keys()
        ].join(', ')}`
      )
      continue
    }
    const matched = [...matching.values()][0]
    if (!matched) continue
    provisional.push({
      companyId,
      source: 'nextmoe',
      externalId: matched.externalId,
      authoritativeValues: matched.values,
      displayName: matched.candidate.displayName
    })
  }

  const storedOwnersByExternalId = new Map<string, Set<number>>()
  for (const company of input.companies) {
    for (const identity of company.externalIds) {
      if (identity.source !== 'nextmoe') continue
      const owners =
        storedOwnersByExternalId.get(identity.externalId) ?? new Set<number>()
      owners.add(company.id)
      storedOwnersByExternalId.set(identity.externalId, owners)
    }
  }

  const proposedByExternalId = new Map<string, ProvisionalNextmoeAction[]>()
  for (const action of provisional) {
    proposedByExternalId.set(action.externalId, [
      ...(proposedByExternalId.get(action.externalId) ?? []),
      action
    ])
  }

  const kept: ProvisionalNextmoeAction[] = []
  for (const [externalId, actions] of proposedByExternalId) {
    const storedOwners =
      storedOwnersByExternalId.get(externalId) ?? new Set<number>()

    if (storedOwners.size > 1) {
      const companyIdsAtStake = [
        ...new Set([
          ...storedOwners,
          ...actions.map((action) => action.companyId)
        ])
      ]
        .sort((left, right) => left - right)
        .map((companyId) => `#${companyId}`)
        .join(', ')
      warnings.push(
        `Do not bind nextmoe:${externalId}: evidence points to companies ${companyIdsAtStake}; choose a canonical company manually`
      )
      continue
    }

    if (storedOwners.size === 1) {
      const ownerId = [...storedOwners][0]
      const ownerAction = actions.find((action) => action.companyId === ownerId)
      const absorbed = actions.filter((action) => action.companyId !== ownerId)
      const authoritativeValues = unionNormalizedValues(
        ownerAction?.authoritativeValues ?? [],
        ...absorbed.map((action) => action.authoritativeValues)
      )
      if (!authoritativeValues.length) continue
      kept.push({
        companyId: ownerId,
        source: 'nextmoe',
        externalId,
        displayName: ownerAction?.displayName ?? actions[0].displayName,
        authoritativeValues
      })
      if (absorbed.length) {
        warnings.push(
          `NextMoe company ${externalId} is already stored on #${ownerId}; dropped proposals for ${absorbed
            .map((action) => `#${action.companyId}`)
            .join(', ')}`
        )
      }
      continue
    }

    if (actions.length < 2) {
      kept.push(...actions)
      continue
    }

    const canonical = pickNextmoeCanonicalCompany(actions, companiesById)
    const absorbed = actions.filter(
      (action) => action.companyId !== canonical.companyId
    )
    kept.push({
      ...canonical,
      authoritativeValues: unionNormalizedValues(
        canonical.authoritativeValues,
        ...absorbed.map((action) => action.authoritativeValues)
      )
    })
    warnings.push(
      `NextMoe company ${externalId} matched companies ${actions
        .map((action) => `#${action.companyId}`)
        .join(', ')}; binding #${canonical.companyId} and absorbing the rest`
    )
  }

  return {
    actions: kept
      .filter((action) => {
        const company = companiesById.get(action.companyId)
        return (
          company !== undefined &&
          !isNextmoeEvidenceProjected(
            company,
            action.externalId,
            action.authoritativeValues
          )
        )
      })
      .map((action) => ({
        companyId: action.companyId,
        source: action.source,
        externalId: action.externalId,
        authoritativeValues: action.authoritativeValues
      })),
    warnings
  }
}

export const buildAuthoritativeAliasCompanyMergePlan = (
  companies: MaintenanceCompany[],
  proposedEvidence: CompanyAuthoritativeEvidencePlan[] = []
): {
  merges: Required<MergeCompaniesPlan>['merges']
  warnings: string[]
} => {
  const proposedByCompany = new Map<number, string[]>()
  for (const evidence of proposedEvidence) {
    proposedByCompany.set(evidence.companyId, [
      ...(proposedByCompany.get(evidence.companyId) ?? []),
      ...evidence.authoritativeValues
    ])
  }
  const companiesByNormalizedName = groupCompaniesBy(
    companies,
    (company) => company.normalizedName
  )
  const inputs = companies.map((company) => {
    const authoritativeNormalized = new Set([
      ...company.identities
        .filter(
          (identity) =>
            identity.kind === 'alias' && identity.origin === 'authoritative'
        )
        .map((identity) => identity.normalizedValue),
      ...(proposedByCompany.get(company.id) ?? []).map(normalizeCompanyValue)
    ])
    const sourceNames = [...authoritativeNormalized].flatMap((normalized) =>
      (companiesByNormalizedName.get(normalized) ?? [])
        .filter((source) => source.id !== company.id)
        .map((source) => source.name)
    )
    return { id: company.id, name: company.name, alias: sourceNames }
  })

  return buildAutoAliasCompanyMergePlan(inputs)
}
