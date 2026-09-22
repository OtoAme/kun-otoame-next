import { Prisma } from '@prisma/client'
import { addPatchCompanyRelations } from './companyRelationHelper'
import { foldLegalCompanySuffix } from '~/app/api/company/identity/legalSuffix'
import {
  COMPANY_IDENTITY_VALUE_MAX_LENGTH,
  isCompanyIdentityValueWithinLimit,
  normalizeCompanyValue
} from '~/app/api/company/identity/normalize'
import type {
  IncomingCompanyPlan,
  LinkCompanySnapshot,
  PlannedCompanyCreate
} from './linkIncomingCompanies'
import { syncCompanyIdentityProjection } from '~/app/api/company/identity/projection'
import type { CompanyIdentityOrigin } from '~/app/api/company/identity/projection'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'

type TxClient = Prisma.TransactionClient

export interface CompanyCreateInput {
  name: string
  introduction?: string
  count?: number
  primary_language?: string[]
  official_website?: string[]
  parent_brand?: string[]
  alias?: string[]
  user_id: number
  normalized_name?: string
}

const companyResolutionSelect = {
  id: true,
  name: true,
  normalized_name: true,
  introduction: true,
  primary_language: true,
  official_website: true,
  parent_brand: true,
  alias: true
} satisfies Prisma.patch_companySelect

type CompanyResolutionRow = Prisma.patch_companyGetPayload<{
  select: typeof companyResolutionSelect
}>

interface PreparedCompanyGroup {
  input: CompanyCreateInput
  lookupValues: string[]
  normalizedLookupValues: string[]
  suffixLookupKeys: string[]
  normalizedName: string
}

export interface CompanyEnsureAmbiguity {
  submittedNames: string[]
  matchedCompanies: Array<{ id: number; name: string }>
}

export class CompanyEnsureAmbiguityError extends PatchSubmissionError {
  readonly ambiguities: CompanyEnsureAmbiguity[]

  constructor(ambiguities: CompanyEnsureAmbiguity[]) {
    const details = ambiguities
      .slice(0, 10)
      .map((ambiguity) => {
        const submitted = ambiguity.submittedNames.join(' / ')
        const matches = ambiguity.matchedCompanies.length
          ? ambiguity.matchedCompanies
              .map((company) => `#${company.id} ${company.name}`)
              .join('、')
          : '同批候选互相重叠'
        return `${submitted} → ${matches}`
      })
      .join('；')
    super(`会社名称或别名存在歧义，未建立关系：${details}`)
    this.name = 'CompanyEnsureAmbiguityError'
    this.ambiguities = ambiguities
  }
}

export const uniqueTrimmed = (names: string[]) => [
  ...new Set(names.map((name) => name.trim()).filter(Boolean))
]

const validCompanyIdentityValues = (values: string[]) =>
  uniqueTrimmed(values).filter(
    (value) =>
      value.length <= COMPANY_IDENTITY_VALUE_MAX_LENGTH &&
      isCompanyIdentityValueWithinLimit(value)
  )

const sameValues = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const mergeCompanyInputs = (
  primary: CompanyCreateInput,
  additional: CompanyCreateInput
): CompanyCreateInput => ({
  name: primary.name.trim(),
  introduction:
    primary.introduction?.trim() || additional.introduction?.trim() || '',
  count: 0,
  primary_language: uniqueTrimmed([
    ...(primary.primary_language ?? []),
    ...(additional.primary_language ?? [])
  ]),
  official_website: uniqueTrimmed([
    ...(primary.official_website ?? []),
    ...(additional.official_website ?? [])
  ]),
  parent_brand: uniqueTrimmed([
    ...(primary.parent_brand ?? []),
    ...(additional.parent_brand ?? [])
  ]),
  alias: validCompanyIdentityValues([
    ...(primary.alias ?? []),
    ...(additional.alias ?? []),
    ...(additional.name.trim() !== primary.name.trim() ? [additional.name] : [])
  ]).filter((alias) => alias !== primary.name.trim()),
  user_id: primary.user_id
})

type RawCompanyGroup = { input: CompanyCreateInput; submittedNames: string[] }

/**
 * Names that only differ by a legal form ("Koei" / "KOEI Co., Ltd.") describe
 * one company, so they are merged into a single group before lookup. The first
 * submitted spelling stays the main name and the others become aliases.
 */
const mergeGroupsByLegalSuffix = (groups: Map<string, RawCompanyGroup>) => {
  const ownersByKey = new Map<string, string[]>()
  for (const normalizedName of groups.keys()) {
    const key = foldLegalCompanySuffix(normalizedName)
    if (!key) continue
    ownersByKey.set(key, [...(ownersByKey.get(key) ?? []), normalizedName])
  }

  for (const owners of ownersByKey.values()) {
    if (owners.length < 2) continue
    const [primaryKey, ...mergedKeys] = owners
    const primary = groups.get(primaryKey)
    if (!primary) continue
    for (const mergedKey of mergedKeys) {
      const merged = groups.get(mergedKey)
      if (!merged) continue
      primary.input = mergeCompanyInputs(primary.input, merged.input)
      primary.submittedNames = uniqueTrimmed([
        ...primary.submittedNames,
        ...merged.submittedNames
      ])
      groups.delete(mergedKey)
    }
  }
}

const prepareCompanyGroups = (
  companiesByName: Map<string, CompanyCreateInput>
): PreparedCompanyGroup[] => {
  const groups = new Map<string, RawCompanyGroup>()

  for (const [rawSubmittedName, rawInput] of companiesByName) {
    const submittedName = rawSubmittedName.trim()
    const name = rawInput.name.trim()
    if (!submittedName || !name) continue
    if (
      name.length > COMPANY_IDENTITY_VALUE_MAX_LENGTH ||
      !isCompanyIdentityValueWithinLimit(name)
    ) {
      continue
    }

    const input: CompanyCreateInput = {
      name,
      introduction: rawInput.introduction?.trim() ?? '',
      count: 0,
      primary_language: uniqueTrimmed(rawInput.primary_language ?? []),
      official_website: uniqueTrimmed(rawInput.official_website ?? []),
      parent_brand: uniqueTrimmed(rawInput.parent_brand ?? []),
      alias: validCompanyIdentityValues(rawInput.alias ?? []).filter(
        (alias) => alias !== name
      ),
      user_id: rawInput.user_id
    }
    const normalizedName = normalizeCompanyValue(name)
    const existing = groups.get(normalizedName)
    if (existing) {
      existing.input = mergeCompanyInputs(existing.input, input)
      existing.submittedNames = uniqueTrimmed([
        ...existing.submittedNames,
        submittedName,
        name
      ])
    } else {
      groups.set(normalizedName, {
        input,
        submittedNames: uniqueTrimmed([submittedName, name])
      })
    }
  }

  mergeGroupsByLegalSuffix(groups)

  const prepared = [...groups.entries()].map(
    ([normalizedName, { input, submittedNames }]) => {
      const lookupValues = validCompanyIdentityValues([
        ...submittedNames,
        input.name,
        ...(input.alias ?? [])
      ])
      const normalizedLookupValues = [
        ...new Set(lookupValues.map(normalizeCompanyValue))
      ]
      return {
        input,
        lookupValues,
        normalizedLookupValues,
        suffixLookupKeys: [
          ...new Set(normalizedLookupValues.map(foldLegalCompanySuffix))
        ].filter(Boolean),
        normalizedName
      }
    }
  )

  const ownersByEvidence = new Map<string, number[]>()
  prepared.forEach((group, index) => {
    for (const value of group.normalizedLookupValues) {
      ownersByEvidence.set(value, [
        ...(ownersByEvidence.get(value) ?? []),
        index
      ])
    }
  })
  const overlappingGroups = new Set<number>()
  for (const owners of ownersByEvidence.values()) {
    if (owners.length > 1) {
      owners.forEach((owner) => overlappingGroups.add(owner))
    }
  }
  if (overlappingGroups.size) {
    throw new CompanyEnsureAmbiguityError(
      [...overlappingGroups].map((index) => ({
        submittedNames: prepared[index].lookupValues,
        matchedCompanies: []
      }))
    )
  }

  return prepared
}

const buildCompanyLookupWhere = (
  companyNames: string[],
  suffixLookupKeys: string[]
): Prisma.patch_companyWhereInput => ({
  OR: [
    ...companyNames.map((name) => ({
      OR: [{ name }, { alias: { has: name } }]
    })),
    // A stored name that carries the legal form never equals the folded key, so
    // the folded key is used as a substring prefilter. Every candidate it
    // returns is re-checked in memory against its folded name, aliases and
    // normalized_name. A row whose legal form only appears inside its alias
    // array is not reachable from SQL and stays a miss.
    ...suffixLookupKeys.map((key) => ({
      normalized_name: { contains: key }
    }))
  ]
})

const uniqueCompanyMatches = (companies: CompanyResolutionRow[]) => [
  ...new Map(companies.map((company) => [company.id, company])).values()
]

const companySuffixLookupKeys = (company: CompanyResolutionRow): string[] =>
  [
    foldLegalCompanySuffix(normalizeCompanyValue(company.name)),
    ...company.alias.map((alias) =>
      foldLegalCompanySuffix(normalizeCompanyValue(alias))
    ),
    ...(company.normalized_name
      ? [foldLegalCompanySuffix(company.normalized_name)]
      : [])
  ].filter(Boolean)

const resolveCompanyGroups = (
  groups: PreparedCompanyGroup[],
  companies: CompanyResolutionRow[],
  allowNormalizedNameFallback: boolean
) => {
  const resolved = new Map<PreparedCompanyGroup, CompanyResolutionRow>()
  const suffixMatched = new Set<PreparedCompanyGroup>()
  const ambiguities: CompanyEnsureAmbiguity[] = []
  const suffixKeysByCompanyId = new Map(
    companies.map((company) => [company.id, companySuffixLookupKeys(company)])
  )

  for (const group of groups) {
    const exactNameMatches = uniqueCompanyMatches(
      companies.filter((company) => group.lookupValues.includes(company.name))
    )
    const aliasMatches = uniqueCompanyMatches(
      companies.filter((company) =>
        company.alias.some((alias) => group.lookupValues.includes(alias))
      )
    )
    const normalizedMatches = allowNormalizedNameFallback
      ? uniqueCompanyMatches(
          companies.filter(
            (company) =>
              company.normalized_name &&
              group.normalizedLookupValues.includes(company.normalized_name)
          )
        )
      : []
    const strongestMatches = exactNameMatches.length
      ? exactNameMatches
      : aliasMatches.length
        ? aliasMatches
        : normalizedMatches

    if (strongestMatches.length > 1) {
      ambiguities.push({
        submittedNames: group.lookupValues,
        matchedCompanies: strongestMatches.map(({ id, name }) => ({ id, name }))
      })
    } else if (strongestMatches.length === 1) {
      resolved.set(group, strongestMatches[0])
    } else if (group.suffixLookupKeys.length) {
      // A legal-form-only difference is the weakest evidence. Exactly one
      // candidate is attached without projecting a new identity; zero or
      // several candidates fall through to the create path, so a suffix
      // collision never blocks a submission.
      const suffixMatches = uniqueCompanyMatches(
        companies.filter((company) =>
          (suffixKeysByCompanyId.get(company.id) ?? []).some((key) =>
            group.suffixLookupKeys.includes(key)
          )
        )
      )
      if (suffixMatches.length === 1) {
        resolved.set(group, suffixMatches[0])
        suffixMatched.add(group)
      }
    }
  }

  if (ambiguities.length) {
    throw new CompanyEnsureAmbiguityError(ambiguities)
  }
  return { resolved, suffixMatched }
}

const enrichExistingCompany = async (
  tx: TxClient,
  companyId: number,
  groups: PreparedCompanyGroup[]
) => {
  const locked = await tx.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM patch_company WHERE id = ${companyId} FOR UPDATE`
  )
  if (!locked.length) throw new Error(`Company #${companyId} not found`)

  const company = await tx.patch_company.findUnique({
    where: { id: companyId },
    select: companyResolutionSelect
  })
  if (!company) throw new Error(`Company #${companyId} not found`)

  const inputs = groups.map((group) => group.input)
  const normalizedCompanyName =
    company.normalized_name ?? normalizeCompanyValue(company.name)
  const aliases = validCompanyIdentityValues([
    ...(company.alias ?? []),
    ...inputs.flatMap((input) => [input.name, ...(input.alias ?? [])])
  ]).filter((alias) => normalizeCompanyValue(alias) !== normalizedCompanyName)
  const primaryLanguages = uniqueTrimmed([
    ...(company.primary_language ?? []),
    ...inputs.flatMap((input) => input.primary_language ?? [])
  ])
  const officialWebsites = uniqueTrimmed([
    ...(company.official_website ?? []),
    ...inputs.flatMap((input) => input.official_website ?? [])
  ])
  const parentBrands = uniqueTrimmed([
    ...(company.parent_brand ?? []),
    ...inputs.flatMap((input) => input.parent_brand ?? [])
  ])
  const introduction =
    company.introduction ||
    inputs.map((input) => input.introduction?.trim()).find(Boolean) ||
    ''
  const data: Prisma.patch_companyUpdateInput = {}
  if (introduction !== company.introduction) data.introduction = introduction
  if (!sameValues(aliases, company.alias)) data.alias = aliases
  if (!sameValues(primaryLanguages, company.primary_language)) {
    data.primary_language = primaryLanguages
  }
  if (!sameValues(officialWebsites, company.official_website)) {
    data.official_website = officialWebsites
  }
  if (!sameValues(parentBrands, company.parent_brand)) {
    data.parent_brand = parentBrands
  }
  if (Object.keys(data).length) {
    await tx.patch_company.update({ where: { id: companyId }, data })
  }
  await syncCompanyIdentityProjection(tx, {
    companyId,
    aliasOrigin: 'authoritative'
  })
}

export const ensureCompanyRelationsByName = async (
  tx: TxClient,
  patchId: number,
  companiesByName: Map<string, CompanyCreateInput>,
  aliasOrigin: CompanyIdentityOrigin = 'legacy',
  constraintCompatibility = false
) => {
  const groups = prepareCompanyGroups(companiesByName)
  if (!groups.length) {
    return { ensured: 0, related: 0, insertedIds: [] as number[] }
  }

  const lookupValues = uniqueTrimmed(
    groups.flatMap((group) => group.lookupValues)
  )
  const suffixLookupKeys = [
    ...new Set(groups.flatMap((group) => group.suffixLookupKeys))
  ]
  const where = buildCompanyLookupWhere(lookupValues, suffixLookupKeys)
  const existing = await tx.patch_company.findMany({
    where,
    select: companyResolutionSelect
  })
  const compatibleExisting = constraintCompatibility
    ? await tx.patch_company.findMany({
        where: {
          normalized_name: {
            in: groups.flatMap((group) => group.normalizedLookupValues)
          }
        },
        select: companyResolutionSelect
      })
    : []
  const existingForResolution = uniqueCompanyMatches([
    ...existing,
    ...compatibleExisting
  ])
  const initiallyResolved = resolveCompanyGroups(
    groups,
    existingForResolution,
    constraintCompatibility
  ).resolved
  const toCreateGroups = groups.filter((group) => !initiallyResolved.has(group))
  const toCreate = toCreateGroups.map((group) => ({
    ...group.input,
    normalized_name: group.normalizedName
  }))

  const insertedCompanies = toCreate.length
    ? await tx.patch_company.createManyAndReturn({
        data: toCreate,
        skipDuplicates: true,
        select: { id: true }
      })
    : []

  const createdExact = toCreate.length
    ? await tx.patch_company.findMany({
        where,
        select: companyResolutionSelect
      })
    : existingForResolution
  // createManyAndReturn({ skipDuplicates: true }) can silently skip a row that
  // lost the normalized_name unique race. ON CONFLICT does not abort the
  // transaction, so the winner can be read safely before relations are added.
  const needsPostConflictFallback = insertedCompanies.length < toCreate.length
  const postConflictWinners = needsPostConflictFallback
    ? await tx.patch_company.findMany({
        where: {
          normalized_name: {
            in: groups.flatMap((group) => group.normalizedLookupValues)
          }
        },
        select: companyResolutionSelect
      })
    : []
  const availableCompanies = uniqueCompanyMatches([
    ...createdExact,
    ...compatibleExisting,
    ...postConflictWinners
  ])
  const resolution = resolveCompanyGroups(
    groups,
    availableCompanies,
    constraintCompatibility || needsPostConflictFallback
  )
  const resolved = resolution.resolved
  const unresolved = groups.filter((group) => !resolved.has(group))
  if (unresolved.length) {
    throw new Error(
      `Failed to resolve companies after ensure: ${unresolved
        .flatMap((group) => group.lookupValues)
        .join(', ')}`
    )
  }

  const insertedCompanyIds = new Set(
    insertedCompanies.map((company) => company.id)
  )
  const groupsByCompanyId = new Map<number, PreparedCompanyGroup[]>()
  for (const [group, company] of resolved) {
    groupsByCompanyId.set(company.id, [
      ...(groupsByCompanyId.get(company.id) ?? []),
      group
    ])
  }
  const orderedCompanyGroups = [...groupsByCompanyId.entries()].sort(
    ([leftId], [rightId]) => leftId - rightId
  )
  for (const [companyId, companyGroups] of orderedCompanyGroups) {
    if (insertedCompanyIds.has(companyId)) {
      await syncCompanyIdentityProjection(tx, { companyId, aliasOrigin })
    } else if (aliasOrigin === 'authoritative') {
      // A company reached only through its legal form keeps its current
      // projection: suffix evidence is too weak to rewrite authoritative rows.
      const enrichableGroups = companyGroups.filter(
        (group) => !resolution.suffixMatched.has(group)
      )
      if (enrichableGroups.length) {
        await enrichExistingCompany(tx, companyId, enrichableGroups)
      }
    }
  }

  const companyIds = [...groupsByCompanyId.keys()]
  const insertedIds = await addPatchCompanyRelations(tx, patchId, companyIds)

  return {
    ensured: insertedCompanies.length,
    related: companyIds.length,
    insertedIds
  }
}

export const appendAuthoritativeSpellings = async (
  tx: TxClient,
  companyId: number,
  spellings: string[]
) => {
  const values = uniqueTrimmed(spellings)
  if (!values.length) return
  const [name, ...alias] = values
  await enrichExistingCompany(tx, companyId, [
    {
      input: { name, alias, user_id: 0 },
      lookupValues: values,
      normalizedLookupValues: values.map((value) => normalizeCompanyValue(value)),
      suffixLookupKeys: [],
      normalizedName: normalizeCompanyValue(name)
    }
  ])
}

export const applyIncomingCompanyPlan = async (
  tx: TxClient,
  patchId: number,
  plan: IncomingCompanyPlan,
  aliasOrigin: CompanyIdentityOrigin,
  constraintCompatibility = false
) => {
  if (plan.blocked.length) {
    throw new CompanyEnsureAmbiguityError(
      plan.blocked.map((item) => ({
        submittedNames: item.spellings,
        matchedCompanies: item.matchedCompanies
      }))
    )
  }

  const insertedRelationIds: number[] = []
  if (plan.create.length) {
    const companiesByName = new Map<string, CompanyCreateInput>(
      plan.create.map((item) => [item.name, plannedCreateInput(item)])
    )
    const created = await ensureCompanyRelationsByName(
      tx,
      patchId,
      companiesByName,
      aliasOrigin,
      constraintCompatibility
    )
    insertedRelationIds.push(...created.insertedIds)
  }

  if (plan.linkIds.length) {
    insertedRelationIds.push(
      ...(await addPatchCompanyRelations(tx, patchId, plan.linkIds))
    )
  }

  if (aliasOrigin === 'authoritative') {
    for (const item of plan.enrich) {
      await appendAuthoritativeSpellings(tx, item.companyId, item.spellings)
    }
  }

  return insertedRelationIds
}

export const loadCompanyLinkSnapshots = async (
  tx: TxClient
): Promise<LinkCompanySnapshot[]> => {
  const rows = await tx.patch_company.findMany({
    select: {
      id: true,
      name: true,
      alias: true,
      normalized_name: true,
      external_ids: { select: { source: true, external_id: true } },
      name_identities: {
        select: { origin: true, kind: true, normalized_value: true }
      }
    }
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    alias: row.alias,
    normalizedName: row.normalized_name,
    externalIds: Object.fromEntries(
      (row.external_ids ?? [])
        .filter((item) => item.source === 'vndb')
        .map((item) => ['vndb', item.external_id])
    ),
    identities: (row.name_identities ?? []).map((identity) => ({
      origin: identity.origin,
      kind: identity.kind,
      normalizedValue: identity.normalized_value
    }))
  }))
}

const plannedCreateInput = (item: PlannedCompanyCreate): CompanyCreateInput => ({
  name: item.name,
  introduction: item.introduction,
  alias: item.alias,
  primary_language: item.primaryLanguage,
  official_website: item.websites,
  user_id: item.userId
})
