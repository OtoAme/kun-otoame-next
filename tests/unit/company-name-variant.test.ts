import { describe, expect, it } from 'vitest'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import { suggestNameVariantHits } from '~/app/api/company/identity/nameVariantSuggestions'

const company = (id: number, name: string) => ({
  id,
  name,
  normalizedName: normalizeCompanyValue(name),
  alias: [] as string[]
})

describe('name variant suggestions', () => {
  it('unions GION Mebius spellings and leaves Cherrymochi out', () => {
    const suggestions = suggestNameVariantHits([
      company(459, 'Mebius'),
      company(460, 'Cherrymochi'),
      company(461, 'Mebius（株式会社メビウス）'),
      company(462, 'mebius.')
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      kind: 'name-variant',
      targetCompanyId: 459,
      sourceCompanyIds: [461, 462],
      foldedKey: 'mebius'
    })
    expect(suggestions[0].names).toEqual([
      'Mebius',
      'Mebius（株式会社メビウス）',
      'mebius.'
    ])
  })

  it('does not merge Tenky, テンキー and KONAMI from the same game', () => {
    expect(
      suggestNameVariantHits([
        company(363, 'KONAMI'),
        company(446, 'Tenky'),
        company(447, 'テンキー')
      ])
    ).toEqual([])
  })

  it('still folds a legal-form pair', () => {
    const suggestions = suggestNameVariantHits([
      company(74, 'Koei'),
      company(463, 'KOEI Co., Ltd.'),
      company(73, 'KOEI TECMO')
    ])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(74)
    expect(suggestions[0].sourceCompanyIds).toEqual([463])
  })

  it('clusters a parenthetical reading and a punctuation-only twin', () => {
    const suggestions = suggestNameVariantHits([
      company(154, 'Sanctuary'),
      company(441, 'Sanctuary（サンクチュアリ）'),
      company(226, 'b_works（ビー・ワークス）'),
      company(297, 'b_works')
    ])
    expect(suggestions.map((item) => item.foldedKey).sort()).toEqual([
      'b_works',
      'sanctuary'
    ])
  })
})
