import { describe, expect, it } from 'vitest'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import {
  nameVariantKeys,
  suggestNameVariantHits
} from '~/app/api/company/identity/nameVariantSuggestions'

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

  it('clusters G.Rev with G.rev Ltd. and leaves KOEI TECMO out of Koei', () => {
    const suggestions = suggestNameVariantHits([
      company(316, 'G.Rev'),
      company(318, 'G.rev Ltd.'),
      company(74, 'Koei'),
      company(73, 'KOEI TECMO')
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(316)
    expect(suggestions[0].sourceCompanyIds).toEqual([318])
    expect(suggestions[0].names).toEqual(['G.Rev', 'G.rev Ltd.'])
  })

  it('clusters Re,AER with Re,AER LLC.', () => {
    const suggestions = suggestNameVariantHits([
      company(350, 'Re,AER'),
      company(348, 'Re,AER LLC.')
    ])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(348)
    expect(suggestions[0].sourceCompanyIds).toEqual([350])
  })

  it('clusters 拓洋興業（TAKUYO） with TAKUYO via the inner parenthetical', () => {
    expect(nameVariantKeys('拓洋興業（TAKUYO）')).toContain('takuyo')

    const suggestions = suggestNameVariantHits([
      company(153, 'TAKUYO'),
      company(245, '拓洋興業（TAKUYO）')
    ])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetCompanyId).toBe(153)
    expect(suggestions[0].sourceCompanyIds).toEqual([245])
  })

  it('clusters CJK-glued Latin names and leaves Latin leftovers apart', () => {
    const glued = suggestNameVariantHits([
      company(369, 'Rolls-Mice'),
      company(370, '劳斯麦斯Rolls-Mice')
    ])
    expect(glued).toHaveLength(1)
    expect(glued[0].targetCompanyId).toBe(369)
    expect(glued[0].sourceCompanyIds).toEqual([370])

    expect(
      suggestNameVariantHits([
        company(1, 'Operetta'),
        company(2, 'Operetta Due')
      ])
    ).toEqual([])
    expect(
      suggestNameVariantHits([
        company(1, 'PlayMeow'),
        company(2, 'PlayMeow Games')
      ])
    ).toEqual([])
  })

  it('does not cluster honeybee with Honeybee Black', () => {
    expect(
      suggestNameVariantHits([
        company(1, 'honeybee'),
        company(2, 'Honeybee Black')
      ])
    ).toEqual([])
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
