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

export const planIncomingCompanyLinks = (
  companies: LinkCompanySnapshot[],
  incoming: IncomingCompanyLink[]
): IncomingCompanyPlan => {
  const linkIds = new Set<number>()
  const enrich: IncomingCompanyPlan['enrich'] = []
  const create: PlannedCompanyCreate[] = []
  const blocked: IncomingCompanyPlan['blocked'] = []
  const variants = companies.map(asVariantCompany)

  incoming.forEach((item, index) => {
    const spellings = unique(item.spellings)
    const createName = item.createName.trim()
    if (!spellings.length || !createName) return

    const externalId = item.externalId?.trim()
    if (externalId) {
      const bound = companies.filter(
        (company) => company.externalIds?.vndb === externalId
      )
      if (bound.length === 1) {
        linkIds.add(bound[0].id)
        enrich.push({ companyId: bound[0].id, spellings })
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

    const exact = companies.filter(
      (company) =>
        spellings.includes(company.name) ||
        company.alias.some((alias) => spellings.includes(alias))
    )
    if (exact.length) {
      for (const company of exact) {
        linkIds.add(company.id)
        enrich.push({ companyId: company.id, spellings })
      }
      return
    }

    const otherSpellings = spellings.filter(
      (spelling) =>
        normalizeCompanyValue(spelling) !== normalizeCompanyValue(createName)
    )
    const classified = classifyIncomingNameVariant(variants, {
      id: -1 - index,
      name: createName,
      normalizedName: normalizeCompanyValue(createName),
      alias: [],
      identities: otherSpellings.map((spelling) => ({
        origin: 'authoritative',
        kind: 'alias',
        normalizedValue: normalizeCompanyValue(spelling)
      })),
      externalIds: externalId ? { vndb: externalId } : {}
    })
    if (classified.kind === 'blocked') {
      blocked.push({ spellings, matchedCompanies: [] })
      return
    }
    if (classified.kind === 'link') {
      for (const id of classified.ids) {
        linkIds.add(id)
        enrich.push({ companyId: id, spellings })
      }
      return
    }

    const keys = suffixKeys(spellings)
    const suffixHits = companies.filter((company) =>
      companySuffixKeys(company).some((key) => keys.includes(key))
    )
    if (suffixHits.length) {
      for (const company of suffixHits) linkIds.add(company.id)
      return
    }

    create.push({
      name: createName,
      alias: unique(item.storeAliases).filter((alias) => alias !== createName),
      introduction: item.introduction?.trim() ?? '',
      primaryLanguage: unique(item.primaryLanguage ?? []),
      websites: unique(item.websites ?? []),
      userId: item.userId
    })
  })

  const createdNames = new Set<string>()
  return {
    linkIds: [...linkIds],
    enrich,
    create: create.filter((item) => {
      const key = normalizeCompanyValue(item.name)
      if (createdNames.has(key)) return false
      createdNames.add(key)
      return true
    }),
    blocked
  }
}
