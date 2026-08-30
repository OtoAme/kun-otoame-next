import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import {
  digestCompanyDatabaseState,
  type CompanyCleanupDecisions,
  type CompanyCleanupPlan,
  type CompanyDatabaseState,
  type CompanyState
} from './companyCleanupFrozenContract'

type CompanyStateClient =
  | Pick<PrismaClient, 'patch_company'>
  | Prisma.TransactionClient

const uniqueSorted = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, 'en')
  )

const opaqueRef = (kind: string, value: number | string) =>
  `${kind}-${createHash('sha256')
    .update(`kun-company-maintenance:${kind}:${value}`)
    .digest('hex')
    .slice(0, 20)}`

export const getCompanyOwnerRef = (userId: number) => opaqueRef('owner', userId)
export const getCompanyConfirmerRef = (userId: number) =>
  opaqueRef('confirmer', userId)

export const getCompanyRef = (company: {
  id: number
  name: string
  normalizedName: string | null
}) =>
  `company-${company.id}-${createHash('sha256')
    .update(`${company.name}\u0000${company.normalizedName ?? ''}`)
    .digest('hex')
    .slice(0, 12)}`

export const loadCompanyDatabaseState = async (
  db: CompanyStateClient
): Promise<CompanyDatabaseState> => {
  const rows = await db.patch_company.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      normalized_name: true,
      introduction: true,
      count: true,
      primary_language: true,
      official_website: true,
      parent_brand: true,
      alias: true,
      user_id: true,
      updated: true,
      external_ids: {
        orderBy: [{ source: 'asc' }, { external_id: 'asc' }],
        select: { source: true, external_id: true }
      },
      name_identities: {
        orderBy: [{ kind: 'asc' }, { normalized_value: 'asc' }, { id: 'asc' }],
        select: {
          kind: true,
          origin: true,
          value: true,
          normalized_value: true,
          confirmed_by_user_id: true
        }
      },
      patch_relations: {
        orderBy: [{ patch_id: 'asc' }, { id: 'asc' }],
        select: {
          patch_id: true,
          patch: { select: { unique_id: true, vndb_id: true } }
        }
      }
    }
  })

  return {
    companies: rows.map((row) => {
      const normalizedName = row.normalized_name as string | null
      return {
        id: row.id,
        ref: getCompanyRef({
          id: row.id,
          name: row.name,
          normalizedName
        }),
        name: row.name,
        normalizedName,
        introduction: row.introduction,
        count: row.count,
        primaryLanguage: uniqueSorted(row.primary_language),
        sourceWebsites: uniqueSorted(row.official_website),
        parentBrands: uniqueSorted(row.parent_brand),
        aliases: uniqueSorted(row.alias),
        ownerRef: getCompanyOwnerRef(row.user_id),
        updated: row.updated.toISOString(),
        externalIds: row.external_ids.map((external) => ({
          source: external.source,
          externalId: external.external_id
        })),
        identities: row.name_identities.map((identity) => ({
          kind: identity.kind as 'name' | 'alias',
          origin: identity.origin as 'authoritative' | 'legacy',
          value: identity.value,
          normalizedValue: identity.normalized_value,
          confirmedByRef:
            identity.confirmed_by_user_id === null
              ? null
              : getCompanyConfirmerRef(identity.confirmed_by_user_id)
        })),
        relations: row.patch_relations.map((relation) => ({
          patchId: relation.patch_id,
          patchUniqueId: relation.patch.unique_id,
          vndbId: relation.patch.vndb_id
        }))
      }
    })
  }
}

export const toSemanticCompanyDatabaseState = (
  state: CompanyDatabaseState
): CompanyDatabaseState => ({
  companies: state.companies.map((company) => ({
    ...company,
    updated: '1970-01-01T00:00:00.000Z'
  }))
})

export const digestSemanticCompanyDatabaseState = (
  state: CompanyDatabaseState
) => digestCompanyDatabaseState(toSemanticCompanyDatabaseState(state))

const identityPriority = (identity: CompanyState['identities'][number]) =>
  (identity.origin === 'authoritative' ? 2 : 0) +
  (identity.confirmedByRef ? 1 : 0)

const mergeIdentity = (
  identities: Map<string, CompanyState['identities'][number]>,
  identity: CompanyState['identities'][number]
) => {
  const key = `${identity.kind}\u0000${identity.normalizedValue}`
  const existing = identities.get(key)
  if (!existing || identityPriority(identity) > identityPriority(existing)) {
    identities.set(key, identity)
    return
  }
  if (
    existing.confirmedByRef &&
    identity.confirmedByRef &&
    existing.confirmedByRef !== identity.confirmedByRef
  ) {
    throw new Error(
      `Identity confirmer conflict for ${identity.kind}:${identity.normalizedValue}`
    )
  }
}

const addAliasIdentity = (
  identities: Map<string, CompanyState['identities'][number]>,
  value: string,
  origin: 'authoritative' | 'legacy',
  confirmedByRef: string | null
) => {
  const normalizedValue = normalizeCompanyValue(value)
  if (!normalizedValue) return
  mergeIdentity(identities, {
    kind: 'alias',
    origin,
    value,
    normalizedValue,
    confirmedByRef
  })
}

const buildExpectedTarget = (
  target: CompanyState,
  sources: CompanyState[],
  ownerSource: CompanyState,
  introductionSource: CompanyState
): CompanyState => {
  const relations = new Map(
    [target, ...sources]
      .flatMap((company) => company.relations)
      .map((relation) => [relation.patchId, relation])
  )
  const externalIds = new Map(
    [target, ...sources]
      .flatMap((company) => company.externalIds)
      .map((external) => [
        `${external.source}\u0000${external.externalId}`,
        external
      ])
  )
  const identities = new Map<string, CompanyState['identities'][number]>()
  for (const identity of target.identities) mergeIdentity(identities, identity)
  for (const source of sources) {
    for (const identity of source.identities) {
      if (identity.kind === 'name') {
        addAliasIdentity(
          identities,
          identity.value,
          identity.origin,
          identity.confirmedByRef
        )
      } else {
        mergeIdentity(identities, identity)
      }
    }
    addAliasIdentity(identities, source.name, 'legacy', null)
  }

  const targetNameIdentity = target.identities.find(
    (identity) => identity.kind === 'name'
  ) ?? {
    kind: 'name' as const,
    origin: 'authoritative' as const,
    value: target.name,
    normalizedValue: normalizeCompanyValue(target.name),
    confirmedByRef: null
  }
  for (const [key, identity] of identities) {
    if (identity.kind === 'name') identities.delete(key)
  }
  mergeIdentity(identities, targetNameIdentity)

  const aliases = uniqueSorted([
    ...target.aliases,
    ...sources.flatMap((source) => [source.name, ...source.aliases]),
    ...[...identities.values()]
      .filter((identity) => identity.kind === 'alias')
      .map((identity) => identity.value)
  ]).filter((alias) => normalizeCompanyValue(alias) !== target.normalizedName)

  return {
    ...target,
    introduction: introductionSource.introduction,
    count: relations.size,
    primaryLanguage: uniqueSorted([
      ...target.primaryLanguage,
      ...sources.flatMap((source) => source.primaryLanguage)
    ]),
    sourceWebsites: uniqueSorted([
      ...target.sourceWebsites,
      ...sources.flatMap((source) => source.sourceWebsites)
    ]),
    parentBrands: uniqueSorted([
      ...target.parentBrands,
      ...sources.flatMap((source) => source.parentBrands)
    ]),
    aliases,
    ownerRef: ownerSource.ownerRef,
    externalIds: [...externalIds.values()],
    identities: [...identities.values()],
    relations: [...relations.values()]
  }
}

export const applyEvidenceToState = (
  state: CompanyDatabaseState,
  action: CompanyCleanupPlan['evidenceActions'][number]
) => {
  const company = state.companies.find((row) => row.id === action.companyId)
  if (!company)
    throw new Error(`Evidence company #${action.companyId} is missing`)
  if (
    !company.externalIds.some(
      (identity) =>
        identity.source === action.source &&
        identity.externalId === action.externalId
    )
  ) {
    company.externalIds.push({
      source: action.source,
      externalId: action.externalId
    })
  }
  const identities = new Map(
    company.identities.map((identity) => [
      `${identity.kind}\u0000${identity.normalizedValue}`,
      identity
    ])
  )
  for (const value of action.authoritativeValues) {
    const normalizedValue = normalizeCompanyValue(value)
    if (normalizedValue === company.normalizedName) continue
    addAliasIdentity(identities, value, 'authoritative', null)
  }
  company.identities = [...identities.values()]
  company.aliases = uniqueSorted([
    ...company.aliases,
    ...action.authoritativeValues.filter(
      (value) => normalizeCompanyValue(value) !== company.normalizedName
    )
  ])
}

const assertFinalGlobalIdentityOwnership = (state: CompanyDatabaseState) => {
  const normalizedOwners = new Map<string, number>()
  const externalOwners = new Map<string, number>()
  for (const company of state.companies) {
    if (!company.normalizedName) {
      throw new Error(`Company #${company.id} is missing normalized_name`)
    }
    const nameOwner = normalizedOwners.get(company.normalizedName)
    if (nameOwner && nameOwner !== company.id) {
      throw new Error(
        `Normalized company name ${company.normalizedName} remains shared by #${nameOwner} and #${company.id}`
      )
    }
    normalizedOwners.set(company.normalizedName, company.id)
    for (const external of company.externalIds) {
      const key = `${external.source}\u0000${external.externalId}`
      const externalOwner = externalOwners.get(key)
      if (externalOwner && externalOwner !== company.id) {
        throw new Error(
          `External identity ${external.source}:${external.externalId} remains shared by #${externalOwner} and #${company.id}`
        )
      }
      externalOwners.set(key, company.id)
    }
  }
}

export const applyActionsToCompanyDatabaseState = (
  preState: CompanyDatabaseState,
  evidenceActions: CompanyCleanupPlan['evidenceActions'],
  mergeInputs: Array<{
    kind: 'automatic' | 'manual'
    targetCompanyId: number
    sourceCompanyIds: number[]
    ownerFromCompanyId: number
    introductionFromCompanyId: number
    reason: string
  }>,
  deleteActions: CompanyCleanupPlan['deleteActions']
): {
  state: CompanyDatabaseState
  mergeActions: CompanyCleanupPlan['mergeActions']
} => {
  const state = structuredClone(preState)
  for (const action of evidenceActions) applyEvidenceToState(state, action)

  const mergeActions: CompanyCleanupPlan['mergeActions'] = []
  for (const input of mergeInputs) {
    const byId = new Map(
      state.companies.map((company) => [company.id, company])
    )
    const target = byId.get(input.targetCompanyId)
    if (!target)
      throw new Error(`Merge target #${input.targetCompanyId} is missing`)
    const sources = input.sourceCompanyIds.map((sourceId) => {
      const source = byId.get(sourceId)
      if (!source) throw new Error(`Merge source #${sourceId} is missing`)
      return source
    })
    const participantIds = new Set([
      input.targetCompanyId,
      ...input.sourceCompanyIds
    ])
    if (
      !participantIds.has(input.ownerFromCompanyId) ||
      !participantIds.has(input.introductionFromCompanyId)
    ) {
      throw new Error('Merge metadata sources must be merge participants')
    }
    const expectedTarget = buildExpectedTarget(
      target,
      sources,
      byId.get(input.ownerFromCompanyId)!,
      byId.get(input.introductionFromCompanyId)!
    )
    state.companies = state.companies.filter(
      (company) => !input.sourceCompanyIds.includes(company.id)
    )
    state.companies = state.companies.map((company) =>
      company.id === target.id ? expectedTarget : company
    )
    mergeActions.push({ ...input, expectedTarget })
  }

  for (const action of deleteActions) {
    const company = state.companies.find((row) => row.id === action.companyId)
    if (!company)
      throw new Error(`Delete company #${action.companyId} is missing`)
    if (company.relations.length !== 0) {
      throw new Error(`Delete company #${action.companyId} still has relations`)
    }
    state.companies = state.companies.filter(
      (row) => row.id !== action.companyId
    )
  }
  state.companies.sort((left, right) => left.id - right.id)
  assertFinalGlobalIdentityOwnership(state)
  return { state, mergeActions }
}

export const resolveDecisionCompanyIds = (
  state: CompanyDatabaseState,
  decisions: CompanyCleanupDecisions
) => {
  const byRef = new Map(
    state.companies.map((company) => [company.ref, company])
  )
  const merges = decisions.merges.map((decision) => {
    const target = byRef.get(decision.targetCompanyRef)
    if (!target)
      throw new Error(`Unknown target company ref ${decision.targetCompanyRef}`)
    const sources = decision.sourceCompanyRefs.map((ref) => {
      const source = byRef.get(ref)
      if (!source) throw new Error(`Unknown source company ref ${ref}`)
      return source
    })
    const owner = byRef.get(decision.ownerFromCompanyRef)
    const introduction = byRef.get(decision.introductionFromCompanyRef)
    if (!owner || !introduction) {
      throw new Error('Unknown merge metadata company ref')
    }
    return {
      kind: 'manual' as const,
      targetCompanyId: target.id,
      sourceCompanyIds: sources.map((source) => source.id),
      ownerFromCompanyId: owner.id,
      introductionFromCompanyId: introduction.id,
      reason: decision.reason
    }
  })
  const deletions = decisions.deletions.map((decision) => {
    const company = byRef.get(decision.companyRef)
    if (!company)
      throw new Error(`Unknown delete company ref ${decision.companyRef}`)
    return { companyId: company.id, reason: decision.reason }
  })
  return { merges, deletions }
}

export const validateActionTopology = (
  merges: Array<{ targetCompanyId: number; sourceCompanyIds: number[] }>,
  deleteCompanyIds: number[]
) => {
  const consumedSources = new Set<number>()
  const targets = new Set<number>()
  for (const merge of merges) {
    if (targets.has(merge.targetCompanyId)) {
      throw new Error(`Merge target #${merge.targetCompanyId} is repeated`)
    }
    targets.add(merge.targetCompanyId)
    for (const sourceId of merge.sourceCompanyIds) {
      if (sourceId === merge.targetCompanyId)
        throw new Error('Merge source equals target')
      if (consumedSources.has(sourceId)) {
        throw new Error(`Merge source #${sourceId} is consumed more than once`)
      }
      consumedSources.add(sourceId)
    }
  }
  for (const targetId of targets) {
    if (consumedSources.has(targetId)) {
      throw new Error(`Company #${targetId} is both a merge source and target`)
    }
  }
  const deleted = new Set<number>()
  for (const companyId of deleteCompanyIds) {
    if (deleted.has(companyId)) {
      throw new Error(`Company #${companyId} is deleted more than once`)
    }
    deleted.add(companyId)
    if (targets.has(companyId) || consumedSources.has(companyId)) {
      throw new Error(`Company #${companyId} is both deleted and merged`)
    }
  }
}
