import {
  foldLegalCompanySuffix,
  foldParentheticalName,
  foldPunctuation
} from './legalSuffix'
import { normalizeCompanyValue } from './normalize'

export const NAME_VARIANT_KIND = 'name-variant'

export type NameVariantSuggestion = {
  kind: typeof NAME_VARIANT_KIND
  targetCompanyId: number
  sourceCompanyIds: number[]
  foldedKey: string
  names: string[]
}

type VariantCompany = {
  id: number
  name: string
  normalizedName: string | null
  alias: string[]
  identities?: Array<{ origin: string; kind: string; normalizedValue: string }>
  externalIds?: Record<string, string | number | null | undefined>
}

const MIN_KEY_LENGTH = 2

/**
 * Keys that may connect two spellings of the same studio: legal-form suffix,
 * punctuation/spacing, and a parenthetical note. Alias arrays stay out — those
 * are historical labels, not identity.
 */
export const nameVariantKeys = (
  raw: string,
  normalizedName?: string | null
): string[] => {
  const normalized = normalizedName ?? normalizeCompanyValue(raw)
  const suffix = foldLegalCompanySuffix(normalized)
  const noParen = foldParentheticalName(raw)
  const noParenSuffix = foldLegalCompanySuffix(noParen)
  const keys = [
    suffix,
    foldPunctuation(normalized),
    foldPunctuation(suffix),
    noParen,
    noParenSuffix,
    foldPunctuation(noParen),
    foldPunctuation(noParenSuffix)
  ].filter((key) => key.length >= MIN_KEY_LENGTH)
  return [...new Set(keys)]
}

const clusterKeys = (company: VariantCompany): string[] => {
  const keys = [
    ...nameVariantKeys(company.name, company.normalizedName),
    ...(company.identities ?? [])
      .filter((identity) => identity.origin === 'authoritative')
      .flatMap((identity) =>
        nameVariantKeys(identity.normalizedValue, identity.normalizedValue)
      )
  ]
  return [...new Set(keys)]
}

const hasConflictingExternalIds = (members: VariantCompany[]): boolean => {
  const valuesBySource = new Map<string, Set<string>>()
  for (const member of members) {
    for (const [source, rawValue] of Object.entries(member.externalIds ?? {})) {
      const value = String(rawValue ?? '').trim()
      if (!value) continue
      const values = valuesBySource.get(source) ?? new Set<string>()
      values.add(value)
      valuesBySource.set(source, values)
    }
  }
  return [...valuesBySource.values()].some((values) => values.size > 1)
}

const findRoot = (parent: Map<number, number>, id: number): number => {
  let current = parent.get(id) ?? id
  while (parent.get(current) !== current) {
    const next = parent.get(current)
    if (next === undefined) break
    parent.set(current, parent.get(next) ?? next)
    current = next
  }
  return current
}

const union = (parent: Map<number, number>, left: number, right: number) => {
  const rootLeft = findRoot(parent, left)
  const rootRight = findRoot(parent, right)
  if (rootLeft === rootRight) return
  if (rootLeft < rootRight) parent.set(rootRight, rootLeft)
  else parent.set(rootLeft, rootRight)
}

/**
 * Closed unique-hit clusters: companies that share a name-variant key, with
 * nobody outside the cluster holding that key. Same-game lists like GION's
 * Mebius / mebius. / Mebius（株式会社メビウス） collapse to one suggestion;
 * Cherrymochi on the same game stays out because it does not share a key.
 */
export function suggestNameVariantHits(
  companies: VariantCompany[]
): NameVariantSuggestion[] {
  const parent = new Map(companies.map((company) => [company.id, company.id]))
  const membersByKey = new Map<string, Set<number>>()
  const keysByCompany = new Map<number, string[]>()

  for (const company of companies) {
    const keys = clusterKeys(company)
    keysByCompany.set(company.id, keys)
    for (const key of keys) {
      const members = membersByKey.get(key) ?? new Set<number>()
      members.add(company.id)
      membersByKey.set(key, members)
    }
  }

  for (const members of membersByKey.values()) {
    const ids = [...members]
    for (let index = 1; index < ids.length; index += 1) {
      union(parent, ids[0], ids[index])
    }
  }

  const groups = new Map<number, VariantCompany[]>()
  for (const company of companies) {
    const root = findRoot(parent, company.id)
    groups.set(root, [...(groups.get(root) ?? []), company])
  }

  const suggestions: NameVariantSuggestion[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const memberIds = new Set(members.map((company) => company.id))
    const memberKeys = [
      ...new Set(members.flatMap((company) => keysByCompany.get(company.id) ?? []))
    ]
    const closed = memberKeys.every((key) => {
      const holders = membersByKey.get(key)
      return holders && [...holders].every((id) => memberIds.has(id))
    })
    if (!closed) continue
    if (hasConflictingExternalIds(members)) continue

    const ordered = [...members].sort((left, right) => left.id - right.id)
    const [target, ...sources] = ordered
    const sharedKeys = memberKeys.filter((key) =>
      members.every((company) =>
        (keysByCompany.get(company.id) ?? []).includes(key)
      )
    )
    const foldedKey = [...sharedKeys].sort(
      (left, right) => right.length - left.length || left.localeCompare(right)
    )[0] ?? ordered.map((company) => company.id).join('-')

    suggestions.push({
      kind: NAME_VARIANT_KIND,
      targetCompanyId: target.id,
      sourceCompanyIds: sources.map((company) => company.id),
      foldedKey,
      names: ordered.map((company) => company.name)
    })
  }

  return suggestions.sort(
    (left, right) => left.targetCompanyId - right.targetCompanyId
  )
}
