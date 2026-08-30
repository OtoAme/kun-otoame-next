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

export interface CompanyAuthoritativeEvidencePlan {
  companyId: number
  source: CompanyCandidateSource
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
    const matching = new Map<
      string,
      { trusted: TrustedCompanyCandidate; values: string[] }
    >()
    for (const trusted of candidates) {
      if (
        trusted.trust !== 'verified' ||
        trusted.candidate.source !== 'vndb' ||
        !trusted.candidate.externalId.trim()
      ) {
        continue
      }
      const values = candidateValues(trusted)
      if (
        !values.some(
          (value) => normalizeCompanyValue(value) === company.normalizedName
        )
      ) {
        continue
      }
      const externalId = trusted.candidate.externalId.trim().toLowerCase()
      const key = `vndb\u0000${externalId}`
      const current = matching.get(key)
      matching.set(key, {
        trusted,
        values: [
          ...new Map(
            [...(current?.values ?? []), ...values].map((value) => [
              normalizeCompanyValue(value),
              value
            ])
          ).values()
        ]
      })
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
