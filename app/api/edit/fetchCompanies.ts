import { prisma } from '~/prisma/index'
import {
  invalidateCompanyCaches,
  invalidatePatchContentCache
} from '~/app/api/patch/cache'
import type { VndbProducer } from '~/lib/arnebiae/vndb'
import { ensureCompanyRelationsByName } from './companyEnsureHelper'
import { runWithCompanyIdentityConstraintRetry } from '~/app/api/company/identity/retry'
import { loadVndbDevelopers } from './vndbCompanyCandidates'

export { fetchVerifiedVndbCompanyCandidates } from './vndbCompanyCandidates'

const uniq = <T>(arr: T[]) => Array.from(new Set(arr))

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
  if (!id) return { ensured: 0, related: 0 }

  try {
    const devs = await loadVndbDevelopers(id)

    if (!devs.length) return { ensured: 0, related: 0 }

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
    if (!companyNames.length) return { ensured: 0, related: 0 }

    const result = await runWithCompanyIdentityConstraintRetry((attempt) =>
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

    if (result.insertedIds.length) {
      const patch = await prisma.patch.findUnique({
        where: { id: patchId },
        select: { unique_id: true }
      })
      await Promise.all([
        invalidateCompanyCaches(),
        patch ? invalidatePatchContentCache(patch.unique_id) : Promise.resolve()
      ])
    }

    return { ensured: result.ensured, related: result.related }
  } catch (error) {
    console.error('Failed to ensure VNDB company relations', {
      patchId,
      source: 'vndb_company_relation',
      vndbId: id,
      error
    })
    return { ensured: 0, related: 0 }
  }
}
