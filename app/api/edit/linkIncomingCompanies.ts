import { foldLegalCompanySuffix } from '~/app/api/company/identity/legalSuffix'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import {
  classifyIncomingNameVariant,
  type NameVariantCompany
} from '~/app/api/company/identity/nameVariantSuggestions'

export type LinkCompanySnapshot = {
  id: number
  name: string
  alias: string[]
  normalizedName: string | null
  externalIds?: Record<string, string>
  identities?: NameVariantCompany['identities']
}

export type IncomingCompanyLink = {
  /** name and original only. Alias-bag strings must not be included. */
  spellings: string[]
  createName: string
  storeAliases: string[]
  introduction?: string
  primaryLanguage?: string[]
  websites?: string[]
  externalId?: string
  userId: number
}

export type PlannedCompanyCreate = {
  name: string
  alias: string[]
  introduction: string
  primaryLanguage: string[]
  websites: string[]
  userId: number
}

export type IncomingCompanyPlan = {
  linkIds: number[]
  enrich: Array<{ companyId: number; spellings: string[] }>
  create: PlannedCompanyCreate[]
  blocked: Array<{ spellings: string[]; matchedCompanies: Array<{ id: number; name: string }> }>
}

const unique = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean))
]

const asVariantCompany = (company: LinkCompanySnapshot): NameVariantCompany => ({
  id: company.id,
  name: company.name,
  normalizedName: company.normalizedName,
  alias: company.alias,
  identities: company.identities,
  externalIds: company.externalIds
})

const suffixKeys = (values: string[]) =>
  unique(values)
    .map((value) => foldLegalCompanySuffix(normalizeCompanyValue(value)))
    .filter(Boolean)

const companySuffixKeys = (company: LinkCompanySnapshot) =>
  suffixKeys([
    company.name,
    ...company.alias,
    ...(company.normalizedName ? [company.normalizedName] : [])
  ])

const aliasIdentities = (aliases: string[]): NameVariantCompany['identities'] =>
  aliases.map((alias) => ({
    origin: 'authoritative',
    kind: 'alias',
    normalizedValue: normalizeCompanyValue(alias)
  }))

export const planIncomingCompanyLinks = (
  companies: LinkCompanySnapshot[],
  incoming: IncomingCompanyLink[]
): IncomingCompanyPlan => {
  const linkIds = new Set<number>()
  const enrich: IncomingCompanyPlan['enrich'] = []
  const create: PlannedCompanyCreate[] = []
  const blocked: IncomingCompanyPlan['blocked'] = []
  const working = companies.map((company) => ({
    ...company,
    alias: [...company.alias],
    externalIds: { ...(company.externalIds ?? {}) },
    identities: company.identities ? [...company.identities] : undefined
  }))
  let variants = working.map(asVariantCompany)
  let nextVirtualId = -1
  const virtualCreates = new Map<number, PlannedCompanyCreate>()

  const refreshVariant = (snapshot: LinkCompanySnapshot) => {
    const next = asVariantCompany(snapshot)
    const index = variants.findIndex((company) => company.id === snapshot.id)
    if (index >= 0) variants[index] = next
    else variants.push(next)
  }

  const dropVirtual = (id: number, positiveIds: number[]) => {
    const planned = virtualCreates.get(id)
    const snapshot = working.find((company) => company.id === id)
    if (!planned || !snapshot) return
    const spellings = unique([planned.name, ...planned.alias])
    for (const positiveId of positiveIds) {
      enrich.push({ companyId: positiveId, spellings })
    }
    const createIndex = create.indexOf(planned)
    if (createIndex >= 0) create.splice(createIndex, 1)
    virtualCreates.delete(id)
    const workingIndex = working.findIndex((company) => company.id === id)
    if (workingIndex >= 0) working.splice(workingIndex, 1)
    variants = variants.filter((company) => company.id !== id)
  }

  const foldInto = (
    id: number,
    spellings: string[],
    externalId?: string
  ): boolean => {
    const planned = virtualCreates.get(id)
    const snapshot = working.find((company) => company.id === id)
    if (!planned || !snapshot) return false
    const bound = snapshot.externalIds?.vndb
    if (externalId && bound && bound !== externalId) {
      blocked.push({
        spellings,
        matchedCompanies: [{ id: snapshot.id, name: snapshot.name }]
      })
      return false
    }
    if (externalId && !bound) {
      snapshot.externalIds = { ...(snapshot.externalIds ?? {}), vndb: externalId }
    }
    const extra = unique(spellings).filter(
      (spelling) => spelling !== planned.name && !planned.alias.includes(spelling)
    )
    planned.alias.push(...extra)
    snapshot.alias = unique([...snapshot.alias, ...extra])
    snapshot.identities = aliasIdentities(snapshot.alias)
    refreshVariant(snapshot)
    return true
  }

  const attach = (ids: number[], spellings: string[], externalId?: string) => {
    const positives = ids.filter((id) => id > 0)
    const virtuals = ids.filter((id) => id < 0)
    if (positives.length) {
      for (const id of positives) {
        linkIds.add(id)
        enrich.push({ companyId: id, spellings })
      }
      for (const id of virtuals) dropVirtual(id, positives)
      return
    }
    for (const id of virtuals) foldInto(id, spellings, externalId)
  }

  const rememberCreate = (item: PlannedCompanyCreate, externalId?: string) => {
    const id = nextVirtualId
    nextVirtualId -= 1
    const snapshot: LinkCompanySnapshot = {
      id,
      name: item.name,
      alias: [...item.alias],
      normalizedName: normalizeCompanyValue(item.name),
      externalIds: externalId ? { vndb: externalId } : {},
      identities: aliasIdentities(item.alias)
    }
    working.push(snapshot)
    variants.push(asVariantCompany(snapshot))
    create.push(item)
    virtualCreates.set(id, item)
  }

  incoming.forEach((item, index) => {
    const spellings = unique(item.spellings)
    const createName = item.createName.trim()
    if (!spellings.length || !createName) return
    const externalId = item.externalId?.trim()

    if (externalId) {
      const bound = working.filter(
        (company) => company.externalIds?.vndb === externalId
      )
      if (bound.length === 1) {
        attach([bound[0].id], spellings, externalId)
        return
      }
      if (bound.length > 1) {
        blocked.push({
          spellings,
          matchedCompanies: bound.map((company) => ({
            id: company.id,
            name: company.name
          }))
        })
        return
      }
    }

    const exact = working.filter(
      (company) =>
        spellings.includes(company.name) ||
        company.alias.some((alias) => spellings.includes(alias))
    )
    if (exact.length) {
      attach(
        exact.map((company) => company.id),
        spellings,
        externalId
      )
      return
    }

    const otherSpellings = spellings.filter(
      (spelling) =>
        normalizeCompanyValue(spelling) !== normalizeCompanyValue(createName)
    )
    const classified = classifyIncomingNameVariant(variants, {
      id: -1_000_000 - index,
      name: createName,
      normalizedName: normalizeCompanyValue(createName),
      alias: [],
      identities: aliasIdentities(otherSpellings),
      externalIds: externalId ? { vndb: externalId } : {}
    })
    if (classified.kind === 'blocked') {
      blocked.push({ spellings, matchedCompanies: [] })
      return
    }
    if (classified.kind === 'link') {
      attach(classified.ids, spellings, externalId)
      return
    }

    const keys = suffixKeys(spellings)
    const suffixHits = working.filter((company) =>
      companySuffixKeys(company).some((key) => keys.includes(key))
    )
    if (suffixHits.length) {
      attach(
        suffixHits.map((company) => company.id),
        spellings,
        externalId
      )
      return
    }

    rememberCreate(
      {
        name: createName,
        alias: unique(item.storeAliases).filter((alias) => alias !== createName),
        introduction: item.introduction?.trim() ?? '',
        primaryLanguage: unique(item.primaryLanguage ?? []),
        websites: unique(item.websites ?? []),
        userId: item.userId
      },
      externalId
    )
  })

  return {
    linkIds: [...linkIds].filter((id) => id > 0),
    enrich: enrich.filter((item) => item.companyId > 0),
    create,
    blocked
  }
}
