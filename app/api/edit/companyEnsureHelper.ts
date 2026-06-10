import { Prisma } from '@prisma/client'
import { addPatchCompanyRelations } from './companyRelationHelper'

type TxClient = Prisma.TransactionClient

export type CompanyCreateInput = Prisma.patch_companyCreateManyInput

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
  companies: { id: number; name: string; alias: string[] }[]
) => {
  const nameToId = new Map<string, number>()
  const aliasToId = new Map<string, number>()

  for (const company of companies) {
    nameToId.set(company.name, company.id)
    for (const alias of company.alias) {
      if (!aliasToId.has(alias)) {
        aliasToId.set(alias, company.id)
      }
    }
  }

  return [
    ...new Set(
      companyNames
        .map((name) => nameToId.get(name) ?? aliasToId.get(name))
        .filter((id): id is number => typeof id === 'number')
    )
  ]
}

export const ensureCompanyRelationsByName = async (
  tx: TxClient,
  patchId: number,
  companiesByName: Map<string, CompanyCreateInput>
) => {
  const companyNames = Array.from(companiesByName.keys())
  if (!companyNames.length) {
    return { ensured: 0, related: 0, insertedIds: [] as number[] }
  }

  const where = buildCompanyLookupWhere(companyNames)
  const existing = await tx.patch_company.findMany({
    where,
    select: { id: true, name: true, alias: true }
  })
  const existingCompanyIds = mapSubmittedNamesToCompanyIds(
    companyNames,
    existing
  )
  const existingNameSet = new Set(
    existing.flatMap((company) => [company.name, ...company.alias])
  )

  const toCreate = companyNames
    .filter((name) => !existingNameSet.has(name))
    .map((name) => companiesByName.get(name)!)

  if (toCreate.length) {
    await tx.patch_company.createMany({
      data: toCreate,
      skipDuplicates: true
    })
  }

  const created =
    toCreate.length > 0
      ? await tx.patch_company.findMany({
          where,
          select: { id: true, name: true, alias: true }
        })
      : existing

  const companyIds = mapSubmittedNamesToCompanyIds(companyNames, created)
  const insertedIds = await addPatchCompanyRelations(tx, patchId, companyIds)

  return {
    ensured: toCreate.length,
    related: companyIds.length || existingCompanyIds.length,
    insertedIds
  }
}
