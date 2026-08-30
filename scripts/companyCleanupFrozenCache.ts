import type { PrismaClient } from '@prisma/client'
import { kunMoyuMoe } from '~/config/moyu-moe'
import {
  companyCleanupReceiptSchema,
  getReceiptPath,
  writeCanonicalArtifact,
  type CompanyCleanupPlan,
  type CompanyCleanupReceipt
} from './companyCleanupFrozenContract'
import { readVerifiedCompanyCleanupReceipt } from './companyCleanupFrozenApply'
import { validateFrozenPlanSimulation } from './companyCleanupFrozenApply'
import {
  digestSemanticCompanyDatabaseState,
  loadCompanyDatabaseState
} from './companyCleanupFrozenState'

const CLOUDFLARE_PURGE_BATCH_SIZE = 30

export type CompanyCleanupCacheDependencies = {
  loadState: (
    db: PrismaClient
  ) => Promise<Awaited<ReturnType<typeof loadCompanyDatabaseState>>>
  invalidateRedis: (plan: CompanyCleanupPlan) => Promise<void>
  purgeCloudflare: (
    plan: CompanyCleanupPlan
  ) => Promise<Array<{ status: number; success: boolean }>>
}

const batch = <T>(values: T[], size: number) => {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

const unique = (values: string[]) => [...new Set(values)]

export const invalidateFrozenCompanyCleanupRedis = async (
  plan: CompanyCleanupPlan
) => {
  const [{ delKv, delKvPattern }, { invalidateAnonymousApiResponseCaches }] =
    await Promise.all([
      import('~/lib/redis'),
      import('~/app/api/utils/anonymousApiResponseCache')
    ])
  await Promise.all([
    delKvPattern('company_list:*'),
    delKvPattern('company_galgame_list:*'),
    delKvPattern('home_data:*'),
    delKvPattern('galgame_list:*'),
    delKvPattern('ranking_list:*'),
    delKvPattern('resource_list:*'),
    delKvPattern('tag_galgame_list:*'),
    invalidateAnonymousApiResponseCaches(),
    ...plan.cacheTargets.companyIds.map((companyId) =>
      delKv(`company_detail:${companyId}`)
    ),
    ...plan.cacheTargets.patchUniqueIds.flatMap((uniqueId) => [
      delKv(`patch:${uniqueId}`),
      delKv(`patch:introduction:${uniqueId}`)
    ])
  ])
}

export const purgeFrozenCompanyCleanupCloudflare = async (
  plan: CompanyCleanupPlan
) => {
  const { purgeCloudflareCache } = await import(
    '~/app/api/utils/purgeCloudflareCache'
  )
  const base = kunMoyuMoe.domain.main.replace(/\/$/, '')
  const pageUrls = unique(
    plan.cacheTargets.pagePaths.map(
      (path) => `${base}${path.startsWith('/') ? path : `/${path}`}`
    )
  )
  const apiPrefixes = unique(
    plan.cacheTargets.apiPrefixes.map(
      (path) => `${base}${path.startsWith('/') ? path : `/${path}`}`
    )
  )
  const results: Array<{ status: number; success: boolean }> = []
  for (const files of batch(pageUrls, CLOUDFLARE_PURGE_BATCH_SIZE)) {
    results.push(await purgeCloudflareCache({ files }))
  }
  for (const prefixes of batch(apiPrefixes, CLOUDFLARE_PURGE_BATCH_SIZE)) {
    results.push(await purgeCloudflareCache({ prefixes }))
  }
  return results
}

const defaultDependencies: CompanyCleanupCacheDependencies = {
  loadState: loadCompanyDatabaseState,
  invalidateRedis: invalidateFrozenCompanyCleanupRedis,
  purgeCloudflare: purgeFrozenCompanyCleanupCloudflare
}

const updateReceipt = async (
  planPath: string,
  receipt: CompanyCleanupReceipt,
  patch: CompanyCleanupReceipt['cache']
) => {
  const next = companyCleanupReceiptSchema.parse({ ...receipt, cache: patch })
  await writeCanonicalArtifact(getReceiptPath(planPath), next, {
    replace: true
  })
  return next
}

export const runFrozenCompanyCleanupCache = async (input: {
  db: PrismaClient
  plan: CompanyCleanupPlan
  planPath: string
  planSha256: string
  dependencies?: CompanyCleanupCacheDependencies
}) => {
  validateFrozenPlanSimulation(input.plan)
  const receipt = await readVerifiedCompanyCleanupReceipt(
    input.planPath,
    input.planSha256,
    input.plan.expectedPostDatabaseDigest
  )
  const dependencies = input.dependencies ?? defaultDependencies
  const current = await dependencies.loadState(input.db)
  if (
    digestSemanticCompanyDatabaseState(current) !==
    input.plan.expectedPostDatabaseDigest
  ) {
    throw new Error(
      'Company cleanup cache retry refused because the database is not in the complete planned post-state'
    )
  }

  let redisStatus: 'complete' | 'failed' = 'failed'
  let cloudflareStatus: 'complete' | 'failed' = 'failed'
  const details: string[] = []
  if (receipt.cache.redis === 'complete') {
    redisStatus = 'complete'
  } else {
    try {
      await dependencies.invalidateRedis(input.plan)
      redisStatus = 'complete'
    } catch (error) {
      details.push(
        `Redis invalidation failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  if (receipt.cache.cloudflare === 'complete') {
    cloudflareStatus = 'complete'
  } else {
    try {
      const results = await dependencies.purgeCloudflare(input.plan)
      if (
        results.length > 0 &&
        results.every((result) => result.success === true)
      ) {
        cloudflareStatus = 'complete'
      } else {
        details.push(
          `Cloudflare purge was not confirmed: ${results.map((result) => `${result.status}:${result.success}`).join(', ') || 'no requests'}`
        )
      }
    } catch (error) {
      details.push(
        `Cloudflare purge failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const complete = redisStatus === 'complete' && cloudflareStatus === 'complete'
  const next = await updateReceipt(input.planPath, receipt, {
    status: complete ? 'complete' : 'failed',
    attemptedAt: new Date().toISOString(),
    redis: redisStatus,
    cloudflare: cloudflareStatus,
    isr: 'deferred-to-deploy',
    detail: details.length ? details.join('; ') : null
  })
  if (!complete) {
    throw new Error(
      next.cache.detail ?? 'Company cleanup cache invalidation failed'
    )
  }
  return next
}

export const disconnectCompanyCleanupCacheRedis = async () => {
  const { redis } = await import('~/lib/redis')
  redis.disconnect()
}
