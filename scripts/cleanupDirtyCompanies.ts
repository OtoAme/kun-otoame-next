import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  getEmptyCompanyDeletionCandidates,
  getCompanyMergePreview,
  type MergeCompaniesPlan,
  type MergePreviewCompany
} from './companyMergePlan'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { syncCompanyIdentityProjection } from '~/app/api/company/identity/projection'
import {
  buildAuthoritativeAliasCompanyMergePlan,
  buildCompanyIdentityInventory,
  planAuthoritativeVndbCompanyEvidence,
  type CompanyAuthoritativeEvidencePlan,
  type MaintenanceCompany
} from './companyIdentityMaintenance'
import { fetchVerifiedVndbCompanyCandidates } from '~/app/api/edit/fetchCompanies'
import { collectPatchSubmissionCompanyCandidates } from '~/app/api/patch-submission/companyCandidates'
import { decodePatchSubmissionPayload } from '~/app/api/patch-submission/payloadCodec'
import { planCompanyResolution } from '~/app/api/company/identity/resolver'
import type { TrustedCompanyCandidate } from '~/app/api/company/identity/types'

const shouldApply = process.argv.includes('--apply')
const shouldSkipVndb = process.argv.includes('--skip-vndb')
const PATCH_CONTENT_CACHE_BATCH_SIZE = 100
const VNDB_FETCH_CONCURRENCY = 2

interface LoadedMaintenanceCompany extends MaintenanceCompany {
  relatedVndbIds: string[]
  relatedUniqueIds: string[]
}

type CompanyRelationWithUniqueId = {
  patch_id: number
  company_id: number
  patch?: {
    unique_id: string
  } | null
}

const unique = <T>(values: T[]) => [...new Set(values)]

const loadMaintenanceCompanies = async (): Promise<
  LoadedMaintenanceCompany[]
> => {
  const companies = await prisma.patch_company.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      normalized_name: true,
      alias: true,
      name_identities: {
        select: {
          kind: true,
          origin: true,
          value: true,
          normalized_value: true
        }
      },
      external_ids: {
        select: { source: true, external_id: true }
      },
      patch_relations: {
        select: {
          patch: { select: { vndb_id: true, unique_id: true } }
        }
      }
    }
  })

  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    normalizedName: company.normalized_name,
    alias: company.alias,
    identities: company.name_identities.map((identity) => ({
      kind: identity.kind,
      origin: identity.origin,
      value: identity.value,
      normalizedValue: identity.normalized_value
    })),
    externalIds: company.external_ids.map((identity) => ({
      source: identity.source,
      externalId: identity.external_id
    })),
    relatedVndbIds: unique(
      company.patch_relations
        .map((relation) => relation.patch.vndb_id)
        .filter((value): value is string => Boolean(value))
    ),
    relatedUniqueIds: unique(
      company.patch_relations.map((relation) => relation.patch.unique_id)
    )
  }))
}

const logCompanyIdentityInventory = (companies: LoadedMaintenanceCompany[]) => {
  const inventory = buildCompanyIdentityInventory(companies)
  console.log(
    `Company identity inventory: missing normalized names=${inventory.missingNormalizedNames.length}, normalized name collision groups=${inventory.normalizedNameCollisions.length}, alias/name collisions=${inventory.aliasNameCollisions.length}, shared alias groups=${inventory.sharedAliases.length}, external ID conflict groups=${inventory.externalIdConflicts.length}, legacy aliases=${inventory.legacyAliasCount}`
  )
  for (const collision of inventory.normalizedNameCollisions) {
    console.warn(
      `  normalized name "${collision.value}": ${collision.companies.map((company) => `#${company.id} ${company.name}`).join(', ')}`
    )
  }
  for (const collision of inventory.aliasNameCollisions) {
    console.warn(
      `  ${collision.origin} alias "${collision.alias}" on #${collision.aliasCompany.id} ${collision.aliasCompany.name} matches main name #${collision.nameCompany.id} ${collision.nameCompany.name}`
    )
  }
  for (const collision of inventory.sharedAliases) {
    console.warn(
      `  shared alias "${collision.value}": ${collision.companies.map((company) => `#${company.id} ${company.name}`).join(', ')}`
    )
  }
  for (const collision of inventory.externalIdConflicts) {
    console.warn(
      `  external ID ${collision.value}: ${collision.companies.map((company) => `#${company.id} ${company.name}`).join(', ')}`
    )
  }
  return inventory
}

const fetchRelatedVndbCandidates = async (
  companies: LoadedMaintenanceCompany[]
) => {
  const vndbIds = unique(companies.flatMap((company) => company.relatedVndbIds))
  const candidatesByVndbId = new Map<string, TrustedCompanyCandidate[]>()
  if (shouldSkipVndb) {
    console.log('VNDB evidence fetch skipped by --skip-vndb.')
    return candidatesByVndbId
  }

  let nextIndex = 0
  const worker = async () => {
    for (;;) {
      const index = nextIndex++
      if (index >= vndbIds.length) return
      const vndbId = vndbIds[index]
      try {
        candidatesByVndbId.set(
          vndbId,
          await fetchVerifiedVndbCompanyCandidates(vndbId)
        )
      } catch (error) {
        console.warn(`  failed to fetch VNDB evidence for ${vndbId}`, error)
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(VNDB_FETCH_CONCURRENCY, vndbIds.length) },
      () => worker()
    )
  )
  console.log(
    `VNDB evidence fetched: ${candidatesByVndbId.size}/${vndbIds.length} related VN IDs.`
  )
  return candidatesByVndbId
}

const buildVndbEvidencePlan = async (companies: LoadedMaintenanceCompany[]) => {
  const candidatesByVndbId = await fetchRelatedVndbCandidates(companies)
  return planAuthoritativeVndbCompanyEvidence(
    companies.map((company) => ({
      company,
      candidates: company.relatedVndbIds.flatMap(
        (vndbId) => candidatesByVndbId.get(vndbId) ?? []
      )
    }))
  )
}

const applyCompanyEvidence = async (
  evidence: CompanyAuthoritativeEvidencePlan
) => {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        LOCK TABLE "patch_company_external_id" IN SHARE ROW EXCLUSIVE MODE
      `
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM patch_company WHERE id = ${evidence.companyId} FOR UPDATE`
      )
      const company = await tx.patch_company.findUnique({
        where: { id: evidence.companyId },
        select: {
          name: true,
          alias: true,
          external_ids: {
            where: { source: evidence.source },
            select: { company_id: true, external_id: true }
          }
        }
      })
      if (!company) throw new Error(`Company #${evidence.companyId} not found`)

      const conflicting = company.external_ids.find(
        (identity) => identity.external_id !== evidence.externalId
      )
      if (conflicting) {
        throw new Error(
          `Company #${evidence.companyId} already has conflicting ${evidence.source} identity ${conflicting.external_id}`
        )
      }
      const occupied = await tx.patch_company_external_id.findMany({
        where: {
          source: evidence.source,
          external_id: evidence.externalId
        },
        select: { company_id: true }
      })
      if (
        occupied.some((identity) => identity.company_id !== evidence.companyId)
      ) {
        throw new Error(
          `${evidence.source}:${evidence.externalId} is already assigned to another company`
        )
      }

      const canonical = normalizeCompanyValue(company.name)
      const aliases = new Map(
        company.alias.map((value) => [normalizeCompanyValue(value), value])
      )
      for (const value of evidence.authoritativeValues) {
        const normalized = normalizeCompanyValue(value)
        if (normalized !== canonical && !aliases.has(normalized)) {
          aliases.set(normalized, value)
        }
      }
      const nextAliases = [...aliases.values()]
      if (
        nextAliases.length !== company.alias.length ||
        nextAliases.some((alias, index) => alias !== company.alias[index])
      ) {
        await tx.patch_company.update({
          where: { id: evidence.companyId },
          data: { alias: nextAliases }
        })
      }
      await syncCompanyIdentityProjection(tx, {
        companyId: evidence.companyId
      })
      await tx.patch_company_name_identity.updateMany({
        where: {
          company_id: evidence.companyId,
          kind: 'alias',
          normalized_value: {
            in: evidence.authoritativeValues.map(normalizeCompanyValue)
          }
        },
        data: { origin: 'authoritative', confirmed_by_user_id: null }
      })

      if (
        !company.external_ids.some(
          (identity) => identity.external_id === evidence.externalId
        )
      ) {
        await tx.patch_company_external_id.create({
          data: {
            company_id: evidence.companyId,
            source: evidence.source,
            external_id: evidence.externalId
          }
        })
      }
    },
    { timeout: 60000 }
  )
}

const collectAffectedUniqueIds = (relations: CompanyRelationWithUniqueId[]) =>
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
    const foundCompanyIds = new Set(
      sourceCompanies.map((company) => company.id)
    )
    const missingCompanyIds = sourceCompanyIds.filter(
      (companyId) => !foundCompanyIds.has(companyId)
    )
    console.warn(
      `  skip missing source companies: ${missingCompanyIds.join(', ')}`
    )
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
        const values = sourceRelations.map(
          (relation) =>
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

      await tx.patch_company.update({
        where: { id: plan.targetCompanyId },
        data: {
          normalized_name: normalizeCompanyValue(targetCompany.name),
          alias: preview.nextAliases,
          primary_language: preview.nextPrimaryLanguage,
          official_website: preview.nextOfficialWebsite,
          parent_brand: preview.nextParentBrand
        }
      })
      await syncCompanyIdentityProjection(tx, {
        companyId: plan.targetCompanyId
      })
    },
    { timeout: 60000 }
  )

  return affectedUniqueIds
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
      await Promise.all([
        invalidateCompanyCaches(),
        invalidatePatchListCaches()
      ])
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

const auditPublishedSubmissionCompanyConflicts = async () => {
  const submissions = await prisma.patch_submission.findMany({
    where: { status: 'published' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      payload: true,
      company_candidates: true,
      patch: {
        select: {
          company: {
            select: {
              company: { select: { id: true, name: true } }
            }
          }
        }
      }
    }
  })

  let invalidPayloads = 0
  let snapshotWarnings = 0
  let ambiguities = 0
  let diagnostics = 0
  let auditedSubmissions = 0
  for (const submission of submissions) {
    if (submission.company_candidates === null) continue
    auditedSubmissions += 1

    const payload = decodePatchSubmissionPayload(submission.payload, {
      complete: true
    })
    if (!payload.success) {
      invalidPayloads += 1
      console.warn(
        `  published submission #${submission.id} has an unreadable payload`
      )
      continue
    }
    const collected = collectPatchSubmissionCompanyCandidates({
      payload: payload.data,
      snapshots: submission.company_candidates
    })
    snapshotWarnings += collected.snapshotDiagnostics.length
    const resolution = await planCompanyResolution(prisma, collected.candidates)
    ambiguities += resolution.ambiguities.length
    diagnostics += resolution.diagnostics.length
    if (
      !collected.snapshotDiagnostics.length &&
      !resolution.ambiguities.length &&
      !resolution.diagnostics.length
    ) {
      continue
    }
    const actualCompanies =
      submission.patch?.company.map((relation) => relation.company) ?? []
    console.warn(
      `  published submission #${submission.id}: actual companies ${actualCompanies.map((company) => `#${company.id} ${company.name}`).join(', ') || '(none)'}`
    )
    for (const diagnostic of collected.snapshotDiagnostics) {
      console.warn(
        `    snapshot ${diagnostic.source}: ${diagnostic.reason} (${diagnostic.lookupId ?? '—'} -> ${diagnostic.expectedLookupId ?? '—'})`
      )
    }
    for (const ambiguity of resolution.ambiguities) {
      console.warn(
        `    ambiguity ${ambiguity.reason}: ${ambiguity.candidate.source}:${ambiguity.candidate.name} -> ${ambiguity.matchedCompanies.map((company) => `#${company.id} ${company.name}`).join(', ')}`
      )
    }
    for (const diagnostic of resolution.diagnostics) {
      console.warn(
        `    diagnostic ${diagnostic.reason}: ${diagnostic.candidate.source}:${diagnostic.candidate.externalId}:${diagnostic.candidate.name} -> ${diagnostic.matchedCompanies.map((company) => `#${company.id} ${company.name}`).join(', ')}`
      )
    }
  }
  console.log(
    `Published submission company audit: snapshots=${auditedSubmissions}/${submissions.length} published submissions, invalid payloads=${invalidPayloads}, snapshot warnings=${snapshotWarnings}, ambiguities=${ambiguities}, external-id/name diagnostics=${diagnostics}`
  )
}

const run = async () => {
  let companies = await loadMaintenanceCompanies()
  const relatedUniqueIdsByCompanyId = new Map(
    companies.map((company) => [company.id, company.relatedUniqueIds])
  )
  const affectedUniqueIdSet = new Set<string>()
  logCompanyIdentityInventory(companies)
  const evidencePlan = await buildVndbEvidencePlan(companies)
  for (const warning of evidencePlan.warnings) {
    console.warn(`  ${warning}`)
  }
  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} ${evidencePlan.actions.length} authoritative VNDB company evidence updates.`
  )
  for (const evidence of evidencePlan.actions) {
    console.log(
      `  #${evidence.companyId} <- ${evidence.source}:${evidence.externalId}; aliases=${evidence.authoritativeValues.join(', ')}`
    )
    if (shouldApply) {
      await applyCompanyEvidence(evidence)
      for (const uniqueId of relatedUniqueIdsByCompanyId.get(
        evidence.companyId
      ) ?? []) {
        affectedUniqueIdSet.add(uniqueId)
      }
    }
  }

  if (shouldApply && evidencePlan.actions.length) {
    companies = await loadMaintenanceCompanies()
  }
  const autoPlan = buildAuthoritativeAliasCompanyMergePlan(
    companies,
    shouldApply ? [] : evidencePlan.actions
  )

  for (const warning of autoPlan.warnings) {
    console.warn(`  ${warning}`)
  }

  const merges = autoPlan.merges
  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} dirty company cleanup with ${merges.length} authoritative alias merges.`
  )

  const mergeCompanyIds = collectMergeCompanyIdSet(merges)
  const companiesById = await loadMergeCompaniesById(merges)
  for (const merge of merges) {
    for (const uniqueId of await mergeCompanies(merge, companiesById)) {
      affectedUniqueIdSet.add(uniqueId)
    }
  }

  const deletedEmptyCompanyCount = await deleteEmptyCompanies(mergeCompanyIds)
  await auditPublishedSubmissionCompanyConflicts()

  const affectedUniqueIds = [...affectedUniqueIdSet]
  if (!shouldApply) {
    console.log('Affected patch content caches: skipped in dry run for speed.')
    console.log(
      'No data changed. Re-run with --apply to execute evidence updates and authoritative merges.'
    )
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
