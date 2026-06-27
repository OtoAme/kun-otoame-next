import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  buildAutoAliasCompanyMergePlan,
  getEmptyCompanyDeletionCandidates,
  getCompanyMergePreview,
  type MergeCompaniesPlan,
  type MergePreviewCompany
} from './companyMergePlan'

const shouldApply = process.argv.includes('--apply')
const PATCH_CONTENT_CACHE_BATCH_SIZE = 100

type CompanyRelationWithUniqueId = {
  patch_id: number
  company_id: number
  patch?: {
    unique_id: string
  } | null
}

const unique = <T>(values: T[]) => [...new Set(values)]

const collectAffectedUniqueIds = (
  relations: CompanyRelationWithUniqueId[]
) =>
  unique(
    relations
      .map((relation) => relation.patch?.unique_id)
      .filter((uniqueId): uniqueId is string => typeof uniqueId === 'string')
  )

const collectMergeCompanyIds = (
  merges: Required<MergeCompaniesPlan>['merges']
) => [
  ...new Set(
    merges.flatMap((merge) => [
      merge.targetCompanyId,
      ...merge.sourceCompanyIds
    ])
  )
]

const collectMergeCompanyIdSet = (
  merges: Required<MergeCompaniesPlan>['merges']
) => new Set(collectMergeCompanyIds(merges))

const loadMergeCompaniesById = async (
  merges: Required<MergeCompaniesPlan>['merges']
) => {
  const companyIds = collectMergeCompanyIds(merges)
  if (!companyIds.length) {
    return new Map<number, MergePreviewCompany>()
  }

  const companies = await prisma.patch_company.findMany({
    where: { id: { in: companyIds } },
    select: {
      id: true,
      name: true,
      alias: true,
      count: true,
      primary_language: true,
      official_website: true,
      parent_brand: true,
      _count: { select: { patch_relations: true } }
    }
  })

  return new Map(companies.map((company) => [company.id, company]))
}

const validateMerge = (
  plan: Required<MergeCompaniesPlan>['merges'][number],
  companiesById: Map<number, MergePreviewCompany>
) => {
  const sourceCompanyIds = unique(plan.sourceCompanyIds).filter(
    (companyId) => companyId !== plan.targetCompanyId
  )
  const targetCompany = companiesById.get(plan.targetCompanyId)

  if (!targetCompany) {
    throw new Error(`Target company #${plan.targetCompanyId} not found`)
  }
  if (plan.targetName && targetCompany.name !== plan.targetName) {
    throw new Error(
      `Target company #${plan.targetCompanyId} name mismatch: expected ${plan.targetName}, got ${targetCompany.name}`
    )
  }

  const expectedSourceNamesById = new Map(
    plan.sourceCompanyIds.map((companyId, index) => [
      companyId,
      plan.sourceNames?.[index]
    ])
  )
  const sourceCompanies = sourceCompanyIds
    .map((companyId) => companiesById.get(companyId))
    .filter((company): company is MergePreviewCompany => Boolean(company))

  if (sourceCompanies.length !== sourceCompanyIds.length) {
    const foundCompanyIds = new Set(sourceCompanies.map((company) => company.id))
    const missingCompanyIds = sourceCompanyIds.filter(
      (companyId) => !foundCompanyIds.has(companyId)
    )
    console.warn(`  skip missing source companies: ${missingCompanyIds.join(', ')}`)
  }

  const mismatchedSourceCompanies = sourceCompanies.filter((company) => {
    const expectedName = expectedSourceNamesById.get(company.id)
    return expectedName && company.name !== expectedName
  })
  if (mismatchedSourceCompanies.length > 0) {
    throw new Error(
      `Source company name mismatch: ${mismatchedSourceCompanies
        .map(
          (company) =>
            `#${company.id} expected ${expectedSourceNamesById.get(company.id)}, got ${company.name}`
        )
        .join('; ')}`
    )
  }

  return { targetCompany, sourceCompanies }
}

const logMergePreview = (
  targetCompany: MergePreviewCompany,
  sourceCompanies: MergePreviewCompany[],
  preview: ReturnType<typeof getCompanyMergePreview>
) => {
  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} merge into #${targetCompany.id} ${targetCompany.name}`
  )
  for (const company of sourceCompanies) {
    console.log(
      `  merge #${company.id} ${company.name} (count=${company.count}, relations=${company._count.patch_relations})`
    )
  }
  console.log(`  source relations: ${preview.relationCount}`)
  console.log(`  next aliases: ${preview.nextAliases.join(', ') || '(none)'}`)
  console.log(
    `  next primary_language: ${preview.nextPrimaryLanguage.join(', ') || '(none)'}`
  )
  console.log(
    `  next official_website: ${preview.nextOfficialWebsite.join(', ') || '(none)'}`
  )
  console.log(
    `  next parent_brand: ${preview.nextParentBrand.join(', ') || '(none)'}`
  )
}

const mergeCompanies = async (
  plan: Required<MergeCompaniesPlan>['merges'][number],
  companiesById: Map<number, MergePreviewCompany>
) => {
  const { targetCompany, sourceCompanies } = validateMerge(plan, companiesById)
  const sourceCompanyIds = sourceCompanies.map((company) => company.id)

  if (!sourceCompanyIds.length) {
    return []
  }

  const preview = getCompanyMergePreview(
    targetCompany,
    sourceCompanies,
    plan.aliases
  )
  logMergePreview(targetCompany, sourceCompanies, preview)

  if (!shouldApply) {
    return []
  }

  const relations = await prisma.patch_company_relation.findMany({
    where: {
      company_id: { in: [plan.targetCompanyId, ...sourceCompanyIds] }
    },
    select: {
      patch_id: true,
      company_id: true,
      patch: { select: { unique_id: true } }
    }
  })
  const affectedUniqueIds = collectAffectedUniqueIds(relations)
  const sourceRelations = relations.filter((relation) =>
    sourceCompanyIds.includes(relation.company_id)
  )

  await prisma.$transaction(
    async (tx) => {
      if (sourceRelations.length) {
        const values = sourceRelations.map((relation) =>
          Prisma.sql`(${relation.patch_id}, ${plan.targetCompanyId}, NOW(), NOW())`
        )

        await tx.$executeRaw`
          INSERT INTO "patch_company_relation"
            ("patch_id", "company_id", "created", "updated")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("patch_id", "company_id") DO NOTHING
        `
      }

      await tx.patch_company_relation.deleteMany({
        where: { company_id: { in: sourceCompanyIds } }
      })

      await tx.patch_company.deleteMany({
        where: { id: { in: sourceCompanyIds } }
      })

      const actualCount = await tx.patch_company_relation.count({
        where: { company_id: plan.targetCompanyId }
      })

      await tx.patch_company.update({
        where: { id: plan.targetCompanyId },
        data: {
          alias: preview.nextAliases,
          primary_language: preview.nextPrimaryLanguage,
          official_website: preview.nextOfficialWebsite,
          parent_brand: preview.nextParentBrand,
          count: actualCount
        }
      })
    },
    { timeout: 60000 }
  )

  return affectedUniqueIds
}

const fixCompanyCounts = async () => {
  const mismatchedCompanies = await prisma.$queryRaw<
    { id: number; name: string; count: number; actual_count: number }[]
  >`
    SELECT c."id", c."name", c."count", COUNT(r."id")::int AS "actual_count"
    FROM "patch_company" c
    LEFT JOIN "patch_company_relation" r ON r."company_id" = c."id"
    GROUP BY c."id"
    HAVING c."count" <> COUNT(r."id")::int
    ORDER BY c."id" ASC
  `

  if (!mismatchedCompanies.length) {
    console.log('Company counts are already consistent.')
    return
  }

  console.log(`Company count mismatches: ${mismatchedCompanies.length}`)
  for (const company of mismatchedCompanies) {
    console.log(
      `  #${company.id} ${company.name}: count=${company.count}, actual=${company.actual_count}`
    )
  }

  if (!shouldApply) {
    return
  }

  await prisma.$executeRaw`
    UPDATE "patch_company" c
    SET "count" = s."actual_count"
    FROM (
      SELECT c."id", COUNT(r."id")::int AS "actual_count"
      FROM "patch_company" c
      LEFT JOIN "patch_company_relation" r ON r."company_id" = c."id"
      GROUP BY c."id"
    ) s
    WHERE c."id" = s."id"
      AND c."count" <> s."actual_count"
  `
}

const deleteEmptyCompanies = async (
  excludedCompanyIds: Set<number>
): Promise<number> => {
  const companies = await prisma.patch_company.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      _count: { select: { patch_relations: true } }
    }
  })
  const candidates = getEmptyCompanyDeletionCandidates(
    companies,
    excludedCompanyIds
  )

  if (!candidates.length) {
    console.log('No empty companies to delete.')
    return 0
  }

  console.log(`Empty companies to delete: ${candidates.length}`)
  for (const company of candidates) {
    console.log(`  #${company.id} ${company.name}`)
  }

  if (!shouldApply) {
    return 0
  }

  const result = await prisma.patch_company.deleteMany({
    where: {
      id: { in: candidates.map((company) => company.id) },
      patch_relations: { none: {} }
    }
  })
  console.log(`Deleted empty companies: ${result.count}`)
  return result.count
}

const invalidateCaches = async (affectedUniqueIds: string[]) => {
  try {
    const {
      invalidateCompanyCaches,
      invalidatePatchContentCache,
      invalidatePatchListCaches
    } = await import('../app/api/patch/cache')
    const { redis } = await import('../lib/redis')

    try {
      await Promise.all([invalidateCompanyCaches(), invalidatePatchListCaches()])
      for (
        let index = 0;
        index < affectedUniqueIds.length;
        index += PATCH_CONTENT_CACHE_BATCH_SIZE
      ) {
        await Promise.all(
          affectedUniqueIds
            .slice(index, index + PATCH_CONTENT_CACHE_BATCH_SIZE)
            .map((uniqueId) => invalidatePatchContentCache(uniqueId))
        )
      }
    } finally {
      redis.disconnect()
    }
  } catch (error) {
    console.error('Companies were updated, but cache invalidation failed:')
    console.error(error)
    process.exitCode = 1
  }
}

const run = async () => {
  const companies = await prisma.patch_company.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, name: true, alias: true }
  })
  const autoPlan = buildAutoAliasCompanyMergePlan(companies)

  for (const warning of autoPlan.warnings) {
    console.warn(`  ${warning}`)
  }

  const merges = autoPlan.merges
  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} dirty company cleanup with ${merges.length} auto alias merges.`
  )

  const affectedUniqueIdSet = new Set<string>()
  const mergeCompanyIds = collectMergeCompanyIdSet(merges)
  const companiesById = await loadMergeCompaniesById(merges)
  for (const merge of merges) {
    for (const uniqueId of await mergeCompanies(merge, companiesById)) {
      affectedUniqueIdSet.add(uniqueId)
    }
  }

  const deletedEmptyCompanyCount = await deleteEmptyCompanies(mergeCompanyIds)
  await fixCompanyCounts()

  const affectedUniqueIds = [...affectedUniqueIdSet]
  if (!shouldApply) {
    console.log('Affected patch content caches: skipped in dry run for speed.')
    console.log('No data changed. Re-run with --apply to execute this cleanup.')
    return
  }

  console.log(`Empty companies deleted: ${deletedEmptyCompanyCount}`)
  console.log(`Affected patch content caches: ${affectedUniqueIds.length}`)
  await invalidateCaches(affectedUniqueIds)
  console.log('Dirty company cleanup applied.')
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
