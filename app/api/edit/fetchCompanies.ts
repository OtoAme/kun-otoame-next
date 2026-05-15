import { prisma } from '~/prisma/index'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import { fetchVndbVn } from '~/lib/arnebiae/vndb'
import type { VndbProducer } from '~/lib/arnebiae/vndb'
import { addPatchCompanyRelations } from './companyRelationHelper'

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

export const ensurePatchCompaniesFromVNDB = async (
  patchId: number,
  vndbId: string | null | undefined,
  uid: number
) => {
  const id = (vndbId || '').trim()
  if (!id) return { ensured: 0, related: 0 }

  try {
    const data = await fetchVndbVn<{
      developers?: VndbProducer[] | null
    }>(
      ['id', '=', id],
      'id,developers{id,name,original,aliases,lang,type,description,extlinks{url}}'
    )

    const devs = (data.results?.[0]?.developers ?? []).filter(
      (d) => d && (d.type === 'co' || d.type === 'ng' || d.type === 'in')
    ) as VndbProducer[]

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

    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.patch_company.findMany({
          where: { name: { in: companyNames } },
          select: { name: true }
        })
        const existingNames = new Set(existing.map((e) => e.name))

        const toCreate = companyNames
          .filter((n) => !existingNames.has(n))
          .map((n) => companiesByName.get(n)!)

        if (toCreate.length) {
          await tx.patch_company.createMany({
            data: toCreate,
            skipDuplicates: true
          })
        }

        const allCompanies = await tx.patch_company.findMany({
          where: { name: { in: companyNames } },
          select: { id: true }
        })
        const companyIds = allCompanies.map((c) => c.id)
        const insertedIds = await addPatchCompanyRelations(
          tx,
          patchId,
          companyIds
        )

        return {
          ensured: toCreate.length,
          related: companyIds.length,
          insertedIds
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
