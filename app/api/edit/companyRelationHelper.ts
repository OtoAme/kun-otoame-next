import { Prisma } from '@prisma/client'

type TxClient = Prisma.TransactionClient

const normalizeCompanyIds = (companyIds: number[]) => [
  ...new Set(companyIds.filter((id) => Number.isInteger(id) && id > 0))
]

export const addPatchCompanyRelations = async (
  tx: TxClient,
  patchId: number,
  companyIds: number[]
): Promise<number[]> => {
  const uniqueIds = normalizeCompanyIds(companyIds)
  if (!uniqueIds.length) return []

  const values = uniqueIds.map(
    (companyId) => Prisma.sql`(${patchId}, ${companyId}, NOW(), NOW())`
  )
  const inserted = await tx.$queryRaw<{ company_id: number }[]>`
    INSERT INTO "patch_company_relation"
      ("patch_id", "company_id", "created", "updated")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("patch_id", "company_id") DO NOTHING
    RETURNING "company_id"
  `
  const insertedIds = normalizeCompanyIds(
    inserted.map((relation) => relation.company_id)
  )

  return insertedIds
}

export const removePatchCompanyRelations = async (
  tx: TxClient,
  patchId: number,
  companyIds: number[]
): Promise<number[]> => {
  const uniqueIds = normalizeCompanyIds(companyIds)
  if (!uniqueIds.length) return []

  const deleted = await tx.$queryRaw<{ company_id: number }[]>`
    DELETE FROM "patch_company_relation"
    WHERE "patch_id" = ${patchId}
      AND "company_id" IN (${Prisma.join(uniqueIds)})
    RETURNING "company_id"
  `
  const deletedIds = normalizeCompanyIds(
    deleted.map((relation) => relation.company_id)
  )

  return deletedIds
}
