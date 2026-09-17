import { normalizeCompanyValue } from './normalize'

/**
 * Legal forms written without a separator, so they are matched at the edges of
 * the value instead of at a token boundary. NFKC has already converted the
 * fullwidth spellings by the time these are applied.
 */
const CJK_LEGAL_FORMS = ['株式会社', '有限会社'] as const

interface LatinSuffixRule {
  pattern: RegExp
  /** `kk` is a legal form only when a space or punctuation precedes it. */
  requireBoundaryBefore: boolean
}

const LATIN_SUFFIX_RULES: readonly LatinSuffixRule[] = [
  { pattern: /co[\s.,]*ltd\.?$/, requireBoundaryBefore: false },
  { pattern: /inc\.?$/, requireBoundaryBefore: false },
  { pattern: /gmbh\.?$/, requireBoundaryBefore: false },
  { pattern: /kk$/, requireBoundaryBefore: true }
]

const EDGE_SEPARATORS = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu
const SEPARATOR_CHARACTER = /[\s\p{P}\p{S}]/u

const trimSeparators = (value: string) => value.replace(EDGE_SEPARATORS, '')

const stripEdgeCjkLegalForm = (value: string): string | null => {
  for (const form of CJK_LEGAL_FORMS) {
    if (value.startsWith(form)) return value.slice(form.length)
    if (value.endsWith(form)) return value.slice(0, -form.length)
  }
  return null
}

const stripTrailingLatinSuffix = (value: string): string | null => {
  for (const rule of LATIN_SUFFIX_RULES) {
    const match = rule.pattern.exec(value)
    if (!match) continue
    const start = match.index
    const boundaryMissing =
      start === 0
        ? rule.requireBoundaryBefore
        : !SEPARATOR_CHARACTER.test(value[start - 1])
    if (boundaryMissing) continue
    return trimSeparators(value.slice(0, start))
  }
  return null
}

/**
 * Second lookup key for a normalized company name: the same value with its
 * legal form removed, so "koei" and "koei co., ltd." share one key. Suffixes
 * that are part of a name (studio, games, works, soft) are never removed.
 *
 * Returns an empty string when nothing but the legal form is left; callers must
 * treat that as "no key" instead of matching every company.
 */
export const foldLegalCompanySuffix = (normalized: string): string => {
  let current = normalized.trim()
  for (;;) {
    const stripped =
      stripEdgeCjkLegalForm(current) ?? stripTrailingLatinSuffix(current)
    if (stripped === null) return current
    current = trimSeparators(stripped)
  }
}

/**
 * Both lookup keys for one raw value: the ordinary normalized value and its
 * legal-suffix fold, deduplicated and without empties. The folded key is weaker
 * evidence and is never written back as a company identity.
 */
export const legalSuffixLookupKeys = (raw: string): string[] => {
  const normalized = normalizeCompanyValue(raw)
  return [...new Set([normalized, foldLegalCompanySuffix(normalized)])].filter(
    Boolean
  )
}
