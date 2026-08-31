import { prisma } from '~/prisma/index'
import {
  invalidateCompanyCaches,
  invalidatePatchContentCache
} from '~/app/api/patch/cache'
import type { VndbProducer } from '~/lib/arnebiae/vndb'
import {
  CompanyEnsureAmbiguityError,
  ensureCompanyRelationsByName
} from './companyEnsureHelper'
import {
  isCompanyIdentityResolverEnabled,
  runWithCompanyIdentityConstraintRetry
} from '~/app/api/company/identity/retry'
import {
  CompanyResolutionAmbiguityError,
  applyCompanyResolution
} from '~/app/api/company/identity/resolver'
import {
  fetchVerifiedVndbCompanyCandidates,
  loadVndbDevelopers
} from './vndbCompanyCandidates'

export { fetchVerifiedVndbCompanyCandidates } from './vndbCompanyCandidates'

const uniq = <T>(arr: T[]) => Array.from(new Set(arr))

interface EnsuredPatchCompanies {
  ensured: number
  resolved: number
  related: number
}

const emptyEnsureResult = (): EnsuredPatchCompanies => ({
  ensured: 0,
  resolved: 0,
  related: 0
})

const invalidateEnsuredCompanyCaches = async (
  patchId: number,
  result: EnsuredPatchCompanies
) => {
  const tasks: Array<{ action: string; promise: Promise<unknown> }> = []
  if (result.resolved > 0) {
    tasks.push({
      action: 'invalidate company caches',
      promise: invalidateCompanyCaches()
    })
  }
  if (result.related > 0) {
    tasks.push({
      action: 'invalidate patch content cache',
      promise: (async () => {
        const patch = await prisma.patch.findUnique({
          where: { id: patchId },
          select: { unique_id: true }
        })
        if (patch) await invalidatePatchContentCache(patch.unique_id)
      })()
    })
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.promise))
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      // eslint-disable-next-line no-console
      console.error('Failed to invalidate caches after ensuring companies', {
        action: tasks[index].action,
        patchId,
        error: outcome.reason
      })
    }
  })
}

const toCompanyCreate = (producer: VndbProducer, uid: number) => {
  const name = producer?.name ?? ''
  const primary_language = producer?.lang ? [producer.lang] : []
  const aliasRaw = [
    ...(producer?.original ? [producer.original] : []),
    ...(Array.isArray(producer?.aliases) ? producer.aliases : [])
  ].filter(Boolean) as string[]
  const alias = uniq(aliasRaw)
  const official_website = Array.isArray(producer?.extlinks)
    ? uniq(
        producer.extlinks
          .map((l) => l?.url)
          .filter(Boolean)
          .map((u) => String(u))
      )
    : []
  return {
    name,
    introduction: producer.description?.trim() ?? '',
    count: 0,
    primary_language,
    official_website,
    parent_brand: [] as string[],
    alias,
    user_id: uid
  }
}

export const ensurePatchCompaniesFromVNDB = async (
  patchId: number,
  vndbId: string | null | undefined,
  uid: number
) => {
  const id = (vndbId || '').trim()
  if (!id) return emptyEnsureResult()

  let result: EnsuredPatchCompanies
  try {
    if (isCompanyIdentityResolverEnabled()) {
      const candidates = await fetchVerifiedVndbCompanyCandidates(id)
      if (!candidates.length) {
        return emptyEnsureResult()
      }
      const resolution = await runWithCompanyIdentityConstraintRetry(() =>
        prisma.$transaction(
          (tx) => applyCompanyResolution(tx, patchId, candidates, uid),
          { timeout: 60000 }
        )
      )
      result = {
        ensured: resolution.created,
        resolved: resolution.companyIds.length,
        related: resolution.insertedRelationIds.length
      }
    } else {
      const devs = await loadVndbDevelopers(id)

      if (!devs.length) return emptyEnsureResult()

      const companiesByName = new Map<
        string,
        ReturnType<typeof toCompanyCreate>
      >()
      for (const p of devs) {
        const name = p?.name
        if (!name) continue
        if (!companiesByName.has(name)) {
          companiesByName.set(name, toCompanyCreate(p, uid))
        }
      }

      const companyNames = Array.from(companiesByName.keys())
      if (!companyNames.length) return emptyEnsureResult()

      const legacyResult = await runWithCompanyIdentityConstraintRetry(
        (attempt) =>
          prisma.$transaction(
            async (tx) => {
              const relationResult = await ensureCompanyRelationsByName(
                tx,
                patchId,
                companiesByName,
                'authoritative',
                attempt > 1
              )

              return {
                ensured: relationResult.ensured,
                related: relationResult.related,
                insertedIds: relationResult.insertedIds
              }
            },
            { timeout: 60000 }
          )
      )

      result = {
        ensured: legacyResult.ensured,
        resolved: legacyResult.related,
        related: legacyResult.insertedIds.length
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to ensure VNDB company relations', {
      patchId,
      source: 'vndb_company_relation',
      vndbId: id,
      error
    })
    if (
      error instanceof CompanyEnsureAmbiguityError ||
      error instanceof CompanyResolutionAmbiguityError
    ) {
      throw error
    }
    return emptyEnsureResult()
  }

  await invalidateEnsuredCompanyCaches(patchId, result)
  return result
}
