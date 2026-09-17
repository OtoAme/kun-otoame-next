import { foldLegalCompanySuffix } from './legalSuffix'
import { normalizeCompanyValue } from './normalize'

export type SuffixUniqueHitSuggestion = {
  kind: 'suffix-unique-hit'
  targetCompanyId: number
  sourceCompanyIds: number[]
  foldedKey: string
  names: string[]
}

type SuffixSuggestionCompany = {
  id: number
  name: string
  normalizedName: string | null
  alias: string[]
  identities?: Array<{ origin: string; kind: string; normalizedValue: string }>
  externalIds?: Record<string, string | number | null | undefined>
}

/**
 * Cluster evidence is the main name (raw, normalized and folded) plus the
 * authoritative identities. The alias array and legacy identities hold
 * historical spellings, so they are deliberately not clustered on.
 */
const clusterKeys = (company: SuffixSuggestionCompany): string[] => {
  const keys = [
    foldLegalCompanySuffix(normalizeCompanyValue(company.name)),
    ...(company.normalizedName
      ? [foldLegalCompanySuffix(company.normalizedName)]
      : []),
    ...(company.identities ?? [])
      .filter((identity) => identity.origin === 'authoritative')
      .map((identity) => foldLegalCompanySuffix(identity.normalizedValue))
  ].filter(Boolean)
  return [...new Set(keys)]
}

const carriesLegalForm = (company: SuffixSuggestionCompany) =>
  foldLegalCompanySuffix(normalizeCompanyValue(company.name)) !==
  normalizeCompanyValue(company.name)

/** The name without a legal form is the better merge target; ids break ties. */
const rankMembers = (
  members: SuffixSuggestionCompany[]
): SuffixSuggestionCompany[] =>
  [...members].sort(
    (left, right) =>
      Number(carriesLegalForm(left)) - Number(carriesLegalForm(right)) ||
      left.id - right.id
  )

const hasConflictingExternalIds = (
  members: SuffixSuggestionCompany[]
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

/**
 * Companies that only differ by a legal form, for the merge queue of the
 * identity dashboard. Companies are partitioned by folded key, so a cluster is
 * emitted only when every company carrying that key is inside it.
 */
export function suggestSuffixUniqueHits(
  companies: Array<{
    id: number
    name: string
    normalizedName: string | null
    alias: string[]
    identities?: Array<{ origin: string; kind: string; normalizedValue: string }>
    externalIds?: Record<string, string | number | null | undefined>
  }>
): SuffixUniqueHitSuggestion[] {
  const membersByKey = new Map<string, SuffixSuggestionCompany[]>()
  for (const company of companies) {
    for (const key of clusterKeys(company)) {
      membersByKey.set(key, [...(membersByKey.get(key) ?? []), company])
    }
  }

  const suggestions: SuffixUniqueHitSuggestion[] = []
  for (const key of [...membersByKey.keys()].sort()) {
    const members = membersByKey.get(key)
    if (!members || members.length < 2) continue
    if (hasConflictingExternalIds(members)) continue
    const [target, ...sources] = rankMembers(members)
    suggestions.push({
      kind: 'suffix-unique-hit',
      targetCompanyId: target.id,
      sourceCompanyIds: sources.map((company) => company.id),
      foldedKey: key,
      names: [target, ...sources].map((company) => company.name)
    })
  }
  return suggestions
}
