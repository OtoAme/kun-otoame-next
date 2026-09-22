import {
  foldLegalCompanySuffix,
  foldParentheticalName,
  foldPunctuation,
  parentheticalInnerValues
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

export type NameVariantCompany = {
  id: number
  name: string
  normalizedName: string | null
  alias: string[]
  identities?: Array<{ origin: string; kind: string; normalizedValue: string }>
  externalIds?: Record<string, string | number | null | undefined>
}

const MIN_KEY_LENGTH = 2
const CJK_CHAR = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]`
const CJK_PREFIX = new RegExp(`^(${CJK_CHAR}+)`, 'u')
const CJK_SUFFIX = new RegExp(`(${CJK_CHAR}+)$`, 'u')
const ALL_CJK = new RegExp(`^${CJK_CHAR}+$`, 'u')

/**
 * Compact form leftover after stripping a CJK prefix or suffix of length ≥ 2.
 * "劳斯麦斯Rolls-Mice" yields "rollsmice"; "Operetta Due" has a Latin leftover
 * and yields nothing.
 */
const cjkGlueRemainders = (compact: string): string[] => {
  const remainders: string[] = []
  const prefix = CJK_PREFIX.exec(compact)
  if (prefix && prefix[1].length >= 2) {
    const rest = compact.slice(prefix[1].length)
    if (rest.length >= MIN_KEY_LENGTH && !ALL_CJK.test(rest)) {
      remainders.push(rest)
    }
  }
  const suffix = CJK_SUFFIX.exec(compact)
  if (suffix && suffix[1].length >= 2) {
    const rest = compact.slice(0, -suffix[1].length)
    if (rest.length >= MIN_KEY_LENGTH && !ALL_CJK.test(rest)) {
      remainders.push(rest)
    }
  }
  return remainders
}

const variantKeysFromValue = (
  raw: string,
  normalizedName?: string | null
): string[] => {
  const normalized = normalizedName ?? normalizeCompanyValue(raw)
  const suffix = foldLegalCompanySuffix(normalized)
  const punctNormalized = foldPunctuation(normalized)
  const punctSuffix = foldPunctuation(suffix)
  return [
    suffix,
    punctNormalized,
    punctSuffix,
    ...cjkGlueRemainders(punctNormalized),
    ...cjkGlueRemainders(punctSuffix)
  ]
}

/**
 * Keys that may connect two spellings of the same studio: legal-form suffix,
 * punctuation/spacing, a parenthetical note (outer and inner), and CJK glued
 * onto a Latin name. Alias arrays stay out — those are historical labels, not
 * identity.
 */
export const nameVariantKeys = (
  raw: string,
  normalizedName?: string | null
): string[] => {
  const keys = [
    ...variantKeysFromValue(raw, normalizedName),
    ...variantKeysFromValue(foldParentheticalName(raw)),
    ...parentheticalInnerValues(raw).flatMap((inner) =>
      variantKeysFromValue(inner)
    )
  ].filter((key) => key.length >= MIN_KEY_LENGTH)
  return [...new Set(keys)]
}

export const nameVariantClusterKeys = (
  company: NameVariantCompany
): string[] => {
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

export const hasConflictingCompanyExternalIds = (
  members: NameVariantCompany[]
): boolean => {
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
  companies: NameVariantCompany[]
): NameVariantSuggestion[] {
  const parent = new Map(companies.map((company) => [company.id, company.id]))
  const membersByKey = new Map<string, Set<number>>()
  const keysByCompany = new Map<number, string[]>()

  for (const company of companies) {
    const keys = nameVariantClusterKeys(company)
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

  const groups = new Map<number, NameVariantCompany[]>()
  for (const company of companies) {
    const root = findRoot(parent, company.id)
    groups.set(root, [...(groups.get(root) ?? []), company])
  }

  const suggestions: NameVariantSuggestion[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const memberIds = new Set(members.map((company) => company.id))
    const memberKeys = [
      ...new Set(
        members.flatMap((company) => keysByCompany.get(company.id) ?? [])
      )
    ]
    const closed = memberKeys.every((key) => {
      const holders = membersByKey.get(key)
      return holders && [...holders].every((id) => memberIds.has(id))
    })
    if (!closed) continue
    if (hasConflictingCompanyExternalIds(members)) continue

    const ordered = [...members].sort((left, right) => left.id - right.id)
    const [target, ...sources] = ordered
    const sharedKeys = memberKeys.filter((key) =>
      members.every((company) =>
        (keysByCompany.get(company.id) ?? []).includes(key)
      )
    )
    const foldedKey =
      [...sharedKeys].sort(
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

/**
 * Where an incoming spelling sits among existing companies. `none` means it
 * shares no name-variant key. `blocked` means the shared keys are not a closed
 * cluster, or the cluster has conflicting external ids. `link` is the existing
 * companies in that closed cluster.
 */
export const classifyIncomingNameVariant = (
  existing: NameVariantCompany[],
  incoming: NameVariantCompany
): { kind: 'none' } | { kind: 'blocked' } | { kind: 'link'; ids: number[] } => {
  const companies = [
    ...existing.filter((company) => company.id !== incoming.id),
    incoming
  ]
  const parent = new Map(companies.map((company) => [company.id, company.id]))
  const membersByKey = new Map<string, Set<number>>()
  const keysByCompany = new Map<number, string[]>()

  for (const company of companies) {
    const keys = nameVariantClusterKeys(company)
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

  const root = findRoot(parent, incoming.id)
  const members = companies.filter(
    (company) => findRoot(parent, company.id) === root
  )
  const existingMembers = members.filter((company) => company.id !== incoming.id)
  if (!existingMembers.length) return { kind: 'none' }

  const memberIds = new Set(members.map((company) => company.id))
  const memberKeys = [
    ...new Set(members.flatMap((company) => keysByCompany.get(company.id) ?? []))
  ]
  const closed = memberKeys.every((key) => {
    const holders = membersByKey.get(key)
    return holders && [...holders].every((id) => memberIds.has(id))
  })
  if (!closed || hasConflictingCompanyExternalIds(members)) {
    return { kind: 'blocked' }
  }
  return { kind: 'link', ids: existingMembers.map((company) => company.id) }
}
