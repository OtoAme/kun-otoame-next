import 'dotenv/config'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import {
  planCompanyIdentityProjection,
  syncCompanyIdentityProjection
} from '~/app/api/company/identity/projection'
import type { StoredCompanyIdentityProjectionValue } from '~/app/api/company/identity/projection'

const DEFAULT_BATCH_SIZE = 200
const MAX_BATCH_SIZE = 1000

export interface CompanyIdentityBackfillOptions {
  apply: boolean
  batchSize: number
}

export interface CompanyIdentityBackfillCompany {
  id: number
  name: string
  alias: string[]
  normalizedName: string | null
  identities: StoredCompanyIdentityProjectionValue[]
}

export interface CompanyIdentityBackfillDependencies {
  loadCompanies: (
    afterId: number,
    take: number
  ) => Promise<CompanyIdentityBackfillCompany[]>
  syncCompany: (company: CompanyIdentityBackfillCompany) => Promise<{
    normalizedNameUpdated: number
    created: number
    updated: number
    deleted: number
  }>
  close: () => Promise<void>
}

export interface CompanyIdentityBackfillResult {
  scanned: number
  reconciled: number
  normalizedNamesUpdated: number
  identitiesCreated: number
  identitiesUpdated: number
  identitiesDeleted: number
}

export const parseCompanyIdentityBackfillOptions = (
  args: string[]
): CompanyIdentityBackfillOptions => {
  const index = args.indexOf('--batch-size')
  const requested = index >= 0 ? Number(args[index + 1]) : DEFAULT_BATCH_SIZE
  const batchSize = Number.isSafeInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_BATCH_SIZE)
    : DEFAULT_BATCH_SIZE
  return { apply: args.includes('--apply'), batchSize }
}

export const runCompanyIdentityBackfill = async (
  options: CompanyIdentityBackfillOptions,
  dependencies: CompanyIdentityBackfillDependencies
): Promise<CompanyIdentityBackfillResult> => {
  const result: CompanyIdentityBackfillResult = {
    scanned: 0,
    reconciled: 0,
    normalizedNamesUpdated: 0,
    identitiesCreated: 0,
    identitiesUpdated: 0,
    identitiesDeleted: 0
  }
  let afterId = 0

  for (;;) {
    const companies = await dependencies.loadCompanies(
      afterId,
      options.batchSize
    )
    if (!companies.length) break

    for (const company of companies) {
      afterId = company.id
      result.scanned += 1
      const plan = planCompanyIdentityProjection(
        { name: company.name, aliases: company.alias, aliasOrigin: 'legacy' },
        {
          normalizedName: company.normalizedName,
          identities: company.identities
        }
      )
      const planned = {
        normalizedNameUpdated: plan.normalizedNameChanged ? 1 : 0,
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        deleted: plan.obsoleteIds.length
      }
      const synced = options.apply
        ? await dependencies.syncCompany(company)
        : planned
      const changed =
        synced.normalizedNameUpdated +
        synced.created +
        synced.updated +
        synced.deleted
      if (changed > 0) result.reconciled += 1
      result.normalizedNamesUpdated += synced.normalizedNameUpdated
      result.identitiesCreated += synced.created
      result.identitiesUpdated += synced.updated
      result.identitiesDeleted += synced.deleted
    }
  }

  return result
}

export const createCompanyIdentityBackfillDependencies =
  async (): Promise<CompanyIdentityBackfillDependencies> => {
    const pool = new pg.Pool({
      connectionString: process.env.KUN_DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    return {
      loadCompanies: (afterId, take) =>
        prisma.patch_company
          .findMany({
            where: { id: { gt: afterId } },
            orderBy: { id: 'asc' },
            take,
            select: {
              id: true,
              name: true,
              alias: true,
              normalized_name: true,
              name_identities: {
                select: {
                  id: true,
                  kind: true,
                  origin: true,
                  value: true,
                  normalized_value: true,
                  confirmed_by_user_id: true
                }
              }
            }
          })
          .then((companies) =>
            companies.map((company) => ({
              id: company.id,
              name: company.name,
              alias: company.alias,
              normalizedName: company.normalized_name,
              identities: company.name_identities.map((identity) => ({
                id: identity.id,
                kind: identity.kind,
                origin: identity.origin,
                value: identity.value,
                normalizedValue: identity.normalized_value,
                confirmedByUserId: identity.confirmed_by_user_id
              }))
            }))
          ),
      syncCompany: (company) =>
        prisma.$transaction((tx) =>
          syncCompanyIdentityProjection(tx, {
            companyId: company.id,
            aliasOrigin: 'legacy'
          })
        ),
      close: async () => {
        await prisma.$disconnect()
        await pool.end()
      }
    }
  }

const printResult = (
  options: CompanyIdentityBackfillOptions,
  result: CompanyIdentityBackfillResult
) => {
  console.log(
    `Company identity ${options.apply ? 'apply' : 'dry-run'}: scanned=${result.scanned}, ${options.apply ? 'reconciled' : 'would reconcile'}=${result.reconciled}`
  )
  if (options.apply) {
    console.log(
      `  normalized names=${result.normalizedNamesUpdated}, identities created=${result.identitiesCreated}, updated=${result.identitiesUpdated}, deleted=${result.identitiesDeleted}`
    )
  } else {
    console.log(
      `  would update normalized names=${result.normalizedNamesUpdated}, create identities=${result.identitiesCreated}, update=${result.identitiesUpdated}, delete=${result.identitiesDeleted}`
    )
    console.log('  No rows were changed. Re-run with --apply after review.')
  }
}

const shouldRunCli = () => {
  const entry = process.argv[1]
  return Boolean(
    entry && import.meta.url === pathToFileURL(resolve(entry)).href
  )
}

if (shouldRunCli()) {
  const options = parseCompanyIdentityBackfillOptions(process.argv.slice(2))
  let dependencies: CompanyIdentityBackfillDependencies | undefined
  createCompanyIdentityBackfillDependencies()
    .then(async (created) => {
      dependencies = created
      const result = await runCompanyIdentityBackfill(options, dependencies)
      printResult(options, result)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await dependencies?.close()
    })
}
