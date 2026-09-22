import { describe, expect, it } from 'vitest'
import {
  planIncomingCompanyLinks,
  type LinkCompanySnapshot
} from '~/app/api/edit/linkIncomingCompanies'
import { selectLegacyVndbCompanyNames } from '~/app/api/edit/legacyVndbCompanyName'

const company = (
  id: number,
  name: string,
  alias: string[] = []
): LinkCompanySnapshot => ({
  id,
  name,
  alias,
  normalizedName: name.toLowerCase()
})

const producer = (name: string, original: string, aliases: string[] = []) => {
  const selected = selectLegacyVndbCompanyNames({ name, original, aliases })
  return {
    spellings: [name, original],
    createName: selected?.name ?? name,
    storeAliases: selected?.alias ?? [],
    userId: 1,
    externalId: undefined
  }
}

describe('planIncomingCompanyLinks', () => {
  const mebius = [
    company(459, 'Mebius'),
    company(461, 'Mebius（株式会社メビウス）'),
    company(462, 'mebius.')
  ]

  it('gives create and submission the same existing companies', () => {
    const fromProducer = producer('Mebius', '株式会社メビウス')
    const fromString = {
      spellings: ['株式会社メビウス', 'Mebius'],
      createName: '株式会社メビウス',
      storeAliases: ['Mebius'],
      userId: 1
    }
    expect(planIncomingCompanyLinks(mebius, [fromProducer]).create).toEqual([])
    expect(planIncomingCompanyLinks(mebius, [fromString]).create).toEqual([])
    expect(planIncomingCompanyLinks(mebius, [fromProducer]).linkIds.sort()).toEqual(
      planIncomingCompanyLinks(mebius, [fromString]).linkIds.sort()
    )
  })

  it('does not insert a company already covered by a closed name-variant group', () => {
    const onlyOriginal = {
      spellings: ['株式会社メビウス'],
      createName: '株式会社メビウス',
      storeAliases: [],
      userId: 1
    }
    const plan = planIncomingCompanyLinks(mebius, [onlyOriginal])
    expect(plan.create).toEqual([])
    expect(plan.blocked).toEqual([])
    expect(plan.linkIds.sort()).toEqual([459, 461, 462])
  })

  it('does not insert RED FLAGSHIP or EMIQ when the Latin company already exists', () => {
    const companies = [
      company(85, 'RED FLAGSHIP'),
      company(440, 'Red Flagship Co.,Ltd.'),
      company(444, 'EMIQ Inc.')
    ]
    const red = planIncomingCompanyLinks(companies, [
      producer('Red Flagship Co.,Ltd.', '株式会社RED FLAGSHIP')
    ])
    const emiq = planIncomingCompanyLinks(companies, [
      producer('EMIQ Inc.', '株式会社エミック')
    ])
    expect(red.create).toEqual([])
    expect(red.linkIds).toEqual([440])
    expect(emiq.create).toEqual([])
    expect(emiq.linkIds).toEqual([444])
  })

  it('links both Kotama spellings and does not link WINGALD', () => {
    const companies = [
      company(407, 'Kotama Yuri'),
      company(408, 'WINGALD'),
      company(409, '小珠ゆり')
    ]
    const plan = planIncomingCompanyLinks(companies, [
      producer('Kotama Yuri', '小珠ゆり', ['Wingald'])
    ])
    expect(plan.create).toEqual([])
    expect(plan.linkIds.sort()).toEqual([407, 409])
    expect(plan.linkIds).not.toContain(408)
  })

  it('links both Tenky companies and leaves KONAMI on its own row', () => {
    const companies = [
      company(363, 'KONAMI', ['コナミ']),
      company(446, 'Tenky'),
      company(447, 'テンキー')
    ]
    const plan = planIncomingCompanyLinks(companies, [
      producer('KONAMI', 'コナミ'),
      producer('Tenky', 'テンキー')
    ])
    expect(plan.create).toEqual([])
    expect(plan.linkIds.sort()).toEqual([363, 446, 447])
  })

  it('keeps Otomate as the existing row', () => {
    const plan = planIncomingCompanyLinks([company(6, 'Otomate', ['オトメイト'])], [
      producer('Otomate', 'オトメイト')
    ])
    expect(plan.create).toEqual([])
    expect(plan.linkIds).toEqual([6])
  })

  it('does not pull Idea Factory onto a Design Factory producer', () => {
    const companies = [
      company(7, 'Design Factory Co., Ltd.'),
      company(87, 'Idea Factory Co., Ltd.')
    ]
    const plan = planIncomingCompanyLinks(companies, [
      producer('Design Factory Co., Ltd.', 'デザインファクトリー株式会社')
    ])
    expect(plan.create).toEqual([])
    expect(plan.linkIds).toEqual([7])
  })

  it('creates one new company with the original as its name', () => {
    const plan = planIncomingCompanyLinks([], [producer('Brand New', '新会社')])
    expect(plan.linkIds).toEqual([])
    expect(plan.create).toEqual([
      expect.objectContaining({
        name: '新会社',
        alias: ['Brand New']
      })
    ])
  })
})
