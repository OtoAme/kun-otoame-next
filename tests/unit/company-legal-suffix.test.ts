import { describe, expect, it } from 'vitest'
import {
  foldLegalCompanySuffix,
  legalSuffixLookupKeys
} from '~/app/api/company/identity/legalSuffix'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { suggestSuffixUniqueHits } from '~/app/api/company/identity/suffixSuggestions'

const fold = (raw: string) => foldLegalCompanySuffix(normalizeCompanyValue(raw))

const company = (id: number, name: string) => ({
  id,
  name,
  normalizedName: normalizeCompanyValue(name),
  alias: [] as string[]
})

describe('company legal suffix folding', () => {
  it('folds a legal form away so the plain name keeps the same key', () => {
    expect(fold('KOEI Co., Ltd.')).toBe('koei')
    expect(fold('Koei')).toBe('koei')
    expect(fold('KOEI Co.,Ltd.')).toBe('koei')
    expect(fold('Koei co ltd')).toBe('koei')
    expect(fold('Koei Inc.')).toBe('koei')
    expect(fold('Koei Inc')).toBe('koei')
    expect(fold('Koei GmbH')).toBe('koei')
    expect(fold('Koei KK')).toBe('koei')
    expect(fold('Koei, KK')).toBe('koei')
  })

  it('does not treat a parenthetical 株式会社 as a trailing legal form', () => {
    expect(fold('Mebius（株式会社メビウス）')).toBe('mebius(株式会社メビウス)')
  })

  it('is idempotent', () => {
    for (const raw of [
      'KOEI Co., Ltd.',
      'Koei',
      'Koei Inc.',
      '株式会社メビウス',
      'メビウス株式会社',
      'Mebius（株式会社メビウス）',
      'Koei Games',
      '株式会社'
    ]) {
      const once = fold(raw)
      expect(foldLegalCompanySuffix(once)).toBe(once)
    }
  })

  it('folds the Japanese legal forms at either edge but keeps parentheses', () => {
    expect(fold('株式会社メビウス')).toBe('メビウス')
    expect(fold('メビウス株式会社')).toBe('メビウス')
    expect(fold('有限会社メビウス')).toBe('メビウス')
    expect(fold('メビウス')).toBe('メビウス')
    expect(fold('Mebius（株式会社メビウス）')).toBe('mebius(株式会社メビウス)')
    expect(fold('Mebius（株式会社メビウス）')).not.toBe('mebius')
  })

  it('keeps suffixes that belong to the name', () => {
    expect(fold('Studio')).toBe('studio')
    expect(fold('Koei Games')).toBe('koei games')
    expect(fold('Palette Works')).toBe('palette works')
    expect(fold('Key Soft')).toBe('key soft')
    expect(fold('KoeiKK')).toBe('koeikk')
    expect(fold('Zinc')).toBe('zinc')
  })

  it('reports no suffix key when only the legal form remains', () => {
    expect(fold('株式会社')).toBe('')
    expect(fold('')).toBe('')
    expect(legalSuffixLookupKeys('株式会社')).toEqual(['株式会社'])
    expect(legalSuffixLookupKeys('Inc.')).toEqual(['inc.'])
  })

  it('lists the plain and folded key for one raw value', () => {
    expect(legalSuffixLookupKeys('KOEI Co., Ltd.')).toEqual([
      'koei co., ltd.',
      'koei'
    ])
    expect(legalSuffixLookupKeys('Koei')).toEqual(['koei'])
  })
})

describe('suffix unique hit suggestions', () => {
  it('suggests the folded pair and ignores names that only look similar', () => {
    const suggestions = suggestSuffixUniqueHits([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.'),
      company(3, 'Koei Games')
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toEqual({
      kind: 'suffix-unique-hit',
      targetCompanyId: 1,
      sourceCompanyIds: [2],
      foldedKey: 'koei',
      names: ['Koei', 'KOEI Co., Ltd.']
    })
  })

  it('suggests only the companies that share the folded key', () => {
    const suggestions = suggestSuffixUniqueHits([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.'),
      company(3, 'Koei Games'),
      company(4, 'Koei Tecmo')
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].sourceCompanyIds).toEqual([2])
  })

  it('keeps a cluster of three instead of dropping it', () => {
    const suggestions = suggestSuffixUniqueHits([
      company(1, 'Koei'),
      company(2, 'KOEI Co., Ltd.'),
      company(3, 'Koei Inc.')
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(1)
    expect(suggestions[0].sourceCompanyIds).toEqual([2, 3])
    expect(suggestions[0].names).toEqual(['Koei', 'KOEI Co., Ltd.', 'Koei Inc.'])
  })

  it('prefers the name without a legal form as the merge target', () => {
    const suggestions = suggestSuffixUniqueHits([
      company(1, 'KOEI Co., Ltd.'),
      company(2, 'Koei')
    ])

    expect(suggestions[0].targetCompanyId).toBe(2)
    expect(suggestions[0].sourceCompanyIds).toEqual([1])
  })

  it('clusters on authoritative identities and ignores legacy ones', () => {
    const suggestions = suggestSuffixUniqueHits([
      {
        ...company(1, 'Koei'),
        identities: [
          { origin: 'authoritative', kind: 'name', normalizedValue: 'koei' }
        ]
      },
      {
        ...company(2, 'Falcom'),
        identities: [
          {
            origin: 'authoritative',
            kind: 'alias',
            normalizedValue: 'koei co., ltd.'
          }
        ]
      },
      {
        ...company(3, 'Type Moon'),
        identities: [
          { origin: 'legacy', kind: 'alias', normalizedValue: 'koei inc.' }
        ]
      }
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(1)
    expect(suggestions[0].sourceCompanyIds).toEqual([2])
  })

  it('skips a cluster whose members carry different external ids', () => {
    expect(
      suggestSuffixUniqueHits([
        { ...company(1, 'Koei'), externalIds: { vndb: 'p1' } },
        { ...company(2, 'KOEI Co., Ltd.'), externalIds: { vndb: 'p2' } }
      ])
    ).toEqual([])

    expect(
      suggestSuffixUniqueHits([
        { ...company(1, 'Koei'), externalIds: { vndb: 'p1' } },
        { ...company(2, 'KOEI Co., Ltd.'), externalIds: { vndb: 'p1' } }
      ])
    ).toHaveLength(1)
  })
})
