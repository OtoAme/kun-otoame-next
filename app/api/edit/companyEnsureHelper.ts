import { Prisma } from '@prisma/client'
import { addPatchCompanyRelations } from './companyRelationHelper'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { syncCompanyIdentityProjection } from '~/app/api/company/identity/projection'
import type { CompanyIdentityOrigin } from '~/app/api/company/identity/projection'

type TxClient = Prisma.TransactionClient

export type CompanyCreateInput = Omit<
  Prisma.patch_companyCreateManyInput,
  'normalized_name'
> & {
  normalized_name?: string
}

export const uniqueTrimmed = (names: string[]) => [
  ...new Set(names.map((name) => name.trim()).filter(Boolean))
]

const buildCompanyLookupWhere = (
  companyNames: string[]
): Prisma.patch_companyWhereInput => ({
  OR: companyNames.map((name) => ({
    OR: [{ name }, { alias: { has: name } }]
  }))
})

const mapSubmittedNamesToCompanyIds = (
  companyNames: string[],
  companies: {
    id: number
    name: string
    alias: string[]
    normalized_name: string | null
  }[],
  allowNormalizedNameFallback = false
) => {
  const nameToId = new Map<string, number>()
  const aliasToId = new Map<string, number>()
  const normalizedNameToId = new Map<string, number>()

  for (const company of companies) {
    nameToId.set(company.name, company.id)
    for (const alias of company.alias) {
      if (!aliasToId.has(alias)) {
        aliasToId.set(alias, company.id)
      }
    }
    if (
      company.normalized_name &&
      !normalizedNameToId.has(company.normalized_name)
    ) {
      normalizedNameToId.set(company.normalized_name, company.id)
    }
  }

  return [
    ...new Set(
      companyNames
        .map(
          (name) =>
            nameToId.get(name) ??
            aliasToId.get(name) ??
            (allowNormalizedNameFallback
              ? normalizedNameToId.get(normalizeCompanyValue(name))
              : undefined)
        )
        .filter((id): id is number => typeof id === 'number')
    )
  ]
}

export const ensureCompanyRelationsByName = async (
  tx: TxClient,
  patchId: number,
  companiesByName: Map<string, CompanyCreateInput>,
  aliasOrigin: CompanyIdentityOrigin = 'legacy',
  constraintCompatibility = false
) => {
  const companyNames = Array.from(companiesByName.keys())
  if (!companyNames.length) {
    return { ensured: 0, related: 0, insertedIds: [] as number[] }
  }

  const where = buildCompanyLookupWhere(companyNames)
  const existing = await tx.patch_company.findMany({
    where,
    select: { id: true, name: true, alias: true, normalized_name: true }
  })
  const compatibleExisting = constraintCompatibility
    ? await tx.patch_company.findMany({
        where: {
          normalized_name: {
            in: companyNames.map(normalizeCompanyValue)
          }
        },
        select: { id: true, name: true, alias: true, normalized_name: true }
      })
    : []
  const existingForResolution = [
    ...new Map(
      [...existing, ...compatibleExisting].map((company) => [
        company.id,
        company
      ])
    ).values()
  ]
  const existingCompanyIds = mapSubmittedNamesToCompanyIds(
    companyNames,
    existingForResolution,
    constraintCompatibility
  )
  const existingNameSet = new Set(
    existingForResolution.flatMap((company) => [company.name, ...company.alias])
  )
  const compatibleNormalizedNames = new Set(
    compatibleExisting.flatMap((company) =>
      company.normalized_name ? [company.normalized_name] : []
    )
  )

  const toCreate = companyNames
    .filter(
      (name) =>
        !existingNameSet.has(name) &&
        !compatibleNormalizedNames.has(normalizeCompanyValue(name))
    )
    .map((name) => companiesByName.get(name)!)
    .map((company) => ({
      ...company,
      normalized_name: normalizeCompanyValue(company.name)
    }))

  const insertedCompanies = toCreate.length
    ? await tx.patch_company.createManyAndReturn({
        data: toCreate,
        skipDuplicates: true,
        select: { id: true }
      })
    : []

  const createdExact =
    toCreate.length > 0
      ? await tx.patch_company.findMany({
          where,
          select: { id: true, name: true, alias: true, normalized_name: true }
        })
      : existingForResolution
  // createManyAndReturn({ skipDuplicates: true }) can silently skip a row that
  // lost the future normalized_name unique race. Only after observing a skip do
  // we broaden the legacy exact lookup to the normalized winner.
  const needsPostConflictFallback = insertedCompanies.length < toCreate.length
  const postConflictWinners = needsPostConflictFallback
    ? await tx.patch_company.findMany({
        where: {
          normalized_name: {
            in: companyNames.map(normalizeCompanyValue)
          }
        },
        select: { id: true, name: true, alias: true, normalized_name: true }
      })
    : []
  const created = [
    ...new Map(
      [...createdExact, ...compatibleExisting, ...postConflictWinners].map(
        (company) => [company.id, company]
      )
    ).values()
  ]

  const companyIds = mapSubmittedNamesToCompanyIds(
    companyNames,
    created,
    constraintCompatibility || needsPostConflictFallback
  )
  for (const company of insertedCompanies) {
    await syncCompanyIdentityProjection(tx, {
      companyId: company.id,
      aliasOrigin
    })
  }
  const insertedIds = await addPatchCompanyRelations(tx, patchId, companyIds)

  return {
    ensured: insertedCompanies.length,
    related: companyIds.length || existingCompanyIds.length,
    insertedIds
  }
}
