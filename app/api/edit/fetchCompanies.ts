import { prisma } from '~/prisma/index'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import { fetchVndbVn } from '~/lib/arnebiae/vndb'
import type { VndbProducer } from '~/lib/arnebiae/vndb'
import { ensureCompanyRelationsByName } from './companyEnsureHelper'

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
    introduction: alias.toString(),
    count: 0,
    primary_language,
    official_website,
    parent_brand: [] as string[],
    alias,
    user_id: uid
  }
}

export const fetchVndbCompanyCreateMap = async (
  vndbId: string | null | undefined,
  uid: number
) => {
  const id = (vndbId || '').trim()
  const companiesByName = new Map<string, ReturnType<typeof toCompanyCreate>>()
  if (!id) return companiesByName

  const data = await fetchVndbVn<{
    developers?: VndbProducer[] | null
  }>(
    ['id', '=', id],
    'id,developers{id,name,original,aliases,lang,type,description,extlinks{url}}'
  )

  const devs = (data.results?.[0]?.developers ?? []).filter(
    (d) => d && (d.type === 'co' || d.type === 'ng' || d.type === 'in')
  ) as VndbProducer[]

  for (const producer of devs) {
    const name = producer?.name
    if (!name || companiesByName.has(name)) continue
    companiesByName.set(name, toCompanyCreate(producer, uid))
  }

  return companiesByName
}

export const ensurePatchCompaniesFromVNDB = async (
  patchId: number,
  vndbId: string | null | undefined,
  uid: number
) => {
  const id = (vndbId || '').trim()
  if (!id) return { ensured: 0, related: 0 }

  try {
    const companiesByName = await fetchVndbCompanyCreateMap(id, uid)
    if (!companiesByName.size) return { ensured: 0, related: 0 }

    const result = await prisma.$transaction(
      async (tx) => {
        const relationResult = await ensureCompanyRelationsByName(
          tx,
          patchId,
          companiesByName
        )

        return {
          ensured: relationResult.ensured,
          related: relationResult.related,
          insertedIds: relationResult.insertedIds
        }
      },
      { timeout: 60000 }
    )

    if (result.insertedIds.length) {
      await invalidateCompanyCaches()
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
