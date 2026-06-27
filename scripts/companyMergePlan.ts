export type MergeCompaniesPlan = {
  merges?: Array<{
    targetCompanyId: number
    targetName?: string
    sourceCompanyIds: number[]
    sourceNames?: string[]
    aliases?: string[]
  }>
}

export interface AutoAliasCompany {
  id: number
  name: string
  alias: string[]
}

export interface MergePreviewCompany {
  id: number
  name: string
  alias: string[]
  count: number
  primary_language: string[]
  official_website: string[]
  parent_brand: string[]
  _count: {
    patch_relations: number
  }
}

export interface EmptyCompanyCandidate {
  id: number
  name: string
  _count: {
    patch_relations: number
  }
}

export type AutoAliasCompanyMergePlanResult = {
  merges: Required<MergeCompaniesPlan>['merges']
  warnings: string[]
}

export const normalizeCompanyValues = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean))
]

const getAliasTargetsByName = (companies: AutoAliasCompany[]) => {
  const companyNameSet = new Set(companies.map((company) => company.name))
  const aliasTargets = new Map<string, AutoAliasCompany[]>()

  for (const company of companies) {
    for (const alias of normalizeCompanyValues(company.alias)) {
      if (!companyNameSet.has(alias) || alias === company.name) {
        continue
      }

      const targets = aliasTargets.get(alias) ?? []
      targets.push(company)
      aliasTargets.set(alias, targets)
    }
  }

  return aliasTargets
}

const getSharedAliasWarnings = (companies: AutoAliasCompany[]) => {
  const companiesByName = new Map(
    companies.map((company) => [company.name, company])
  )
  const ownersByAlias = new Map<string, AutoAliasCompany[]>()

  for (const company of companies) {
    for (const alias of normalizeCompanyValues(company.alias)) {
      const owners = ownersByAlias.get(alias) ?? []
      owners.push(company)
      ownersByAlias.set(alias, owners)
    }
  }

  return [...ownersByAlias.entries()]
    .filter(
      ([alias, owners]) =>
        owners.length > 1 && !companiesByName.has(alias)
    )
    .map(
      ([alias, owners]) =>
        `Shared alias "${alias}" appears in ${owners
          .map((company) => `#${company.id} ${company.name}`)
          .join(', ')}; choose a canonical company manually`
    )
}

const resolveRootTargetId = (
  sourceId: number,
  sourceToTargetId: Map<number, number>
) => {
  const seen = new Set<number>()
  let currentId = sourceId

  while (sourceToTargetId.has(currentId)) {
    if (seen.has(currentId)) {
      return null
    }
    seen.add(currentId)
    currentId = sourceToTargetId.get(currentId)!
  }

  return currentId === sourceId ? null : currentId
}

export const buildAutoAliasCompanyMergePlan = (
  companies: AutoAliasCompany[]
): AutoAliasCompanyMergePlanResult => {
  const warnings = getSharedAliasWarnings(companies)
  const companiesById = new Map(companies.map((company) => [company.id, company]))
  const companiesByName = new Map(
    companies.map((company) => [company.name, company])
  )
  const aliasTargets = getAliasTargetsByName(companies)
  const sourceToTargetId = new Map<number, number>()
  const ambiguousSourceIds = new Set<number>()

  for (const [sourceName, targets] of aliasTargets) {
    const source = companiesByName.get(sourceName)
    if (!source) {
      continue
    }

    const distinctTargets = targets.filter((target) => target.id !== source.id)
    if (!distinctTargets.length) {
      continue
    }

    const targetIds = [...new Set(distinctTargets.map((target) => target.id))]
    if (targetIds.length > 1) {
      ambiguousSourceIds.add(source.id)
      warnings.push(
        `Skip ambiguous company "${sourceName}" (#${source.id}); matched targets ${distinctTargets
          .map((company) => `#${company.id} ${company.name}`)
          .join(', ')}`
      )
      continue
    }

    sourceToTargetId.set(source.id, targetIds[0])
  }

  const sourcesByRootTarget = new Map<number, AutoAliasCompany[]>()
  for (const sourceId of sourceToTargetId.keys()) {
    const rootTargetId = resolveRootTargetId(sourceId, sourceToTargetId)
    const source = companiesById.get(sourceId)
    if (!source) {
      continue
    }

    if (!rootTargetId) {
      warnings.push(
        `Skip cyclic company "${source.name}" (#${source.id}); use a manual plan`
      )
      continue
    }

    const rootTarget = companiesById.get(rootTargetId)
    if (!rootTarget) {
      warnings.push(
        `Skip company "${source.name}" (#${source.id}); resolved target #${rootTargetId} is missing`
      )
      continue
    }

    if (ambiguousSourceIds.has(rootTarget.id)) {
      warnings.push(
        `Skip alias chain for "${source.name}" (#${source.id}); root target #${rootTarget.id} ${rootTarget.name} is ambiguous`
      )
      continue
    }

    const sources = sourcesByRootTarget.get(rootTargetId) ?? []
    sources.push(source)
    sourcesByRootTarget.set(rootTargetId, sources)
  }

  const merges = [...sourcesByRootTarget.entries()]
    .map(([targetCompanyId, sources]) => {
      const target = companiesById.get(targetCompanyId)!
      const uniqueSources = [
        ...new Map(sources.map((source) => [source.id, source])).values()
      ].filter((source) => source.id !== targetCompanyId)

      return {
        targetCompanyId,
        targetName: target.name,
        sourceCompanyIds: uniqueSources.map((source) => source.id),
        sourceNames: uniqueSources.map((source) => source.name)
      }
    })
    .filter((merge) => merge.sourceCompanyIds.length > 0)
    .sort((a, b) => a.targetCompanyId - b.targetCompanyId)

  return { merges, warnings }
}

export const getCompanyMergePreview = (
  targetCompany: MergePreviewCompany,
  sourceCompanies: MergePreviewCompany[],
  planAliases: string[] = []
) => {
  const relationCount = sourceCompanies.reduce(
    (sum, company) => sum + company._count.patch_relations,
    0
  )
  const nextAliases = normalizeCompanyValues([
    ...targetCompany.alias,
    ...sourceCompanies.map((company) => company.name),
    ...sourceCompanies.flatMap((company) => company.alias),
    ...planAliases
  ]).filter((alias) => alias !== targetCompany.name)
  const nextPrimaryLanguage = normalizeCompanyValues([
    ...targetCompany.primary_language,
    ...sourceCompanies.flatMap((company) => company.primary_language)
  ])
  const nextOfficialWebsite = normalizeCompanyValues([
    ...targetCompany.official_website,
    ...sourceCompanies.flatMap((company) => company.official_website)
  ])
  const nextParentBrand = normalizeCompanyValues([
    ...targetCompany.parent_brand,
    ...sourceCompanies.flatMap((company) => company.parent_brand)
  ])

  return {
    relationCount,
    nextAliases,
    nextPrimaryLanguage,
    nextOfficialWebsite,
    nextParentBrand
  }
}

export const getEmptyCompanyDeletionCandidates = (
  companies: EmptyCompanyCandidate[],
  excludedCompanyIds: Set<number> = new Set()
) =>
  companies
    .filter(
      (company) =>
        company._count.patch_relations === 0 &&
        !excludedCompanyIds.has(company.id)
    )
    .map((company) => ({
      id: company.id,
      name: company.name,
      relationCount: company._count.patch_relations
    }))
