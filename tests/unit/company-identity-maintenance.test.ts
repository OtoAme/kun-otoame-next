import { describe, expect, it } from 'vitest'
import {
  buildAuthoritativeAliasCompanyMergePlan,
  buildCompanyIdentityInventory,
  planAuthoritativeNextmoeCompanyEvidence,
  planAuthoritativeVndbCompanyEvidence,
  type CompanyNextmoeEvidenceCandidate,
  type MaintenanceCompany
} from '~/scripts/companyIdentityMaintenance'
import { normalizeCompanyValue } from '~/app/api/company/identity/normalize'
import type { TrustedCompanyCandidate } from '~/app/api/company/identity/types'

const company = (
  id: number,
  name: string,
  overrides: Partial<MaintenanceCompany> = {}
): MaintenanceCompany => ({
  id,
  name,
  normalizedName: name.toLowerCase(),
  count: 0,
  alias: [],
  identities: [],
  externalIds: [],
  ...overrides
})

const vndbCandidate = (
  externalId: string,
  name: string,
  aliases: string[] = []
): TrustedCompanyCandidate => ({
  trust: 'verified',
  candidate: {
    source: 'vndb',
    externalId,
    name,
    aliases,
    roles: ['developer'],
    sourceRoles: ['developer'],
    entityType: 'company',
    externalUrls: [],
    primaryLanguage: 'ja',
    sourceWebsites: []
  }
})

const nextmoeCandidate = (
  companyId: number,
  externalId: string,
  displayName: string,
  values: string[]
): CompanyNextmoeEvidenceCandidate => ({
  companyId,
  externalId,
  displayName,
  values
})

describe('company identity maintenance inventory', () => {
  it('separates blocking main/external collisions from legal shared aliases', () => {
    const inventory = buildCompanyIdentityInventory([
      company(1, 'First', {
        normalizedName: 'same',
        identities: [
          {
            kind: 'alias',
            origin: 'legacy',
            value: 'Shared',
            normalizedValue: 'shared'
          }
        ],
        externalIds: [{ source: 'vndb', externalId: 'p1' }]
      }),
      company(2, 'Second', {
        normalizedName: 'same',
        identities: [
          {
            kind: 'alias',
            origin: 'authoritative',
            value: 'Shared',
            normalizedValue: 'shared'
          }
        ],
        externalIds: [{ source: 'vndb', externalId: 'p1' }]
      }),
      company(3, 'Shared')
    ])

    expect(inventory.normalizedNameCollisions[0].companies).toHaveLength(2)
    expect(inventory.sharedAliases[0].companies).toHaveLength(2)
    expect(inventory.aliasNameCollisions).toHaveLength(2)
    expect(inventory.externalIdConflicts[0].value).toBe('vndb:p1')
    expect(inventory.legacyAliasCount).toBe(1)
  })
})

describe('authoritative VNDB evidence planning', () => {
  it('binds one producer when the company main name matches authoritative aliases', () => {
    const result = planAuthoritativeVndbCompanyEvidence([
      {
        company: company(1, 'ぱれっと', { normalizedName: 'ぱれっと' }),
        candidates: [vndbCandidate('p1', 'Palette', ['ぱれっと'])]
      }
    ])

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        companyId: 1,
        source: 'vndb',
        externalId: 'p1',
        authoritativeValues: ['Palette', 'ぱれっと']
      }
    ])
  })

  it('does not bind ambiguous or cross-company external identities', () => {
    const ambiguous = planAuthoritativeVndbCompanyEvidence([
      {
        company: company(1, 'Shared', { normalizedName: 'shared' }),
        candidates: [
          vndbCandidate('p1', 'First', ['Shared']),
          vndbCandidate('p2', 'Second', ['Shared'])
        ]
      }
    ])
    expect(ambiguous.actions).toEqual([])
    expect(ambiguous.warnings[0]).toContain('multiple VNDB producers')

    const sharedExternal = planAuthoritativeVndbCompanyEvidence([
      {
        company: company(1, 'Palette', { normalizedName: 'palette' }),
        candidates: [vndbCandidate('p1', 'Palette')]
      },
      {
        company: company(2, 'ＰＡＬＥＴＴＥ', {
          normalizedName: 'palette'
        }),
        candidates: [vndbCandidate('p1', 'Palette')]
      }
    ])
    expect(sharedExternal.actions).toEqual([])
    expect(sharedExternal.warnings.at(-1)).toContain(
      'choose a canonical company manually'
    )
  })

  it('does not rebind an external identity already stored on another company', () => {
    const result = planAuthoritativeVndbCompanyEvidence([
      {
        company: company(1, 'Existing', {
          externalIds: [{ source: 'vndb', externalId: 'p1' }]
        }),
        candidates: []
      },
      {
        company: company(2, 'Palette', { normalizedName: 'palette' }),
        candidates: [vndbCandidate('p1', 'Palette')]
      }
    ])

    expect(result.actions).toEqual([])
    expect(result.warnings.at(-1)).toContain('companies #1, #2')
  })

  it('converges once the external ID and authoritative projection already exist', () => {
    const result = planAuthoritativeVndbCompanyEvidence([
      {
        company: company(1, 'ぱれっと', {
          normalizedName: 'ぱれっと',
          alias: ['Palette'],
          externalIds: [{ source: 'vndb', externalId: 'p1' }],
          identities: [
            {
              kind: 'name',
              origin: 'authoritative',
              value: 'ぱれっと',
              normalizedValue: 'ぱれっと'
            },
            {
              kind: 'alias',
              origin: 'authoritative',
              value: 'Palette',
              normalizedValue: 'palette'
            }
          ]
        }),
        candidates: [vndbCandidate('p1', 'Palette', ['ぱれっと'])]
      }
    ])

    expect(result).toEqual({ actions: [], warnings: [] })
  })
})

describe('authoritative NextMoe evidence planning', () => {
  const koeiCompanies = () => [
    company(12, 'KOEI Co., Ltd.', {
      normalizedName: 'koei co., ltd.',
      count: 5
    }),
    company(34, 'コーエー', { normalizedName: 'コーエー', count: 1 })
  ]

  const koeiValues = ['KOEI Co., Ltd.', 'コーエー']

  it('binds one canonical company when a catalog company matches several local companies', () => {
    const result = planAuthoritativeNextmoeCompanyEvidence({
      companies: koeiCompanies(),
      candidates: [
        nextmoeCandidate(12, '99', 'KOEI Co., Ltd.', koeiValues),
        nextmoeCandidate(34, '99', 'KOEI Co., Ltd.', koeiValues)
      ]
    })

    expect(result.actions).toEqual([
      {
        companyId: 12,
        source: 'nextmoe',
        externalId: '99',
        authoritativeValues: koeiValues
      }
    ])
    expect(result.warnings[0]).toContain('binding #12')
  })

  it('keeps the company that already stores the catalog id instead of rebinding it', () => {
    const companies = koeiCompanies()
    companies[0].externalIds = [{ source: 'nextmoe', externalId: '99' }]

    const result = planAuthoritativeNextmoeCompanyEvidence({
      companies,
      candidates: [
        nextmoeCandidate(12, '99', 'KOEI Co., Ltd.', koeiValues),
        nextmoeCandidate(34, '99', 'KOEI Co., Ltd.', koeiValues)
      ]
    })

    expect(result.actions.some((action) => action.companyId === 34)).toBe(false)
    expect(result.actions).toEqual([
      {
        companyId: 12,
        source: 'nextmoe',
        externalId: '99',
        authoritativeValues: koeiValues
      }
    ])
  })

  it('refuses to bind a catalog id that two companies already store', () => {
    const companies = koeiCompanies()
    companies[0].externalIds = [{ source: 'nextmoe', externalId: '99' }]
    companies[1].externalIds = [{ source: 'nextmoe', externalId: '99' }]

    const result = planAuthoritativeNextmoeCompanyEvidence({
      companies,
      candidates: [nextmoeCandidate(12, '99', 'KOEI Co., Ltd.', koeiValues)]
    })

    expect(result.actions).toEqual([])
    expect(result.warnings[0]).toContain('choose a canonical company manually')
  })

  it('binds an unambiguous single match and stays silent once it is projected', () => {
    const first = planAuthoritativeNextmoeCompanyEvidence({
      companies: [
        company(12, 'KOEI Co., Ltd.', { normalizedName: 'koei co., ltd.' })
      ],
      candidates: [nextmoeCandidate(12, '99', 'KOEI Co., Ltd.', koeiValues)]
    })
    expect(first.actions).toEqual([
      {
        companyId: 12,
        source: 'nextmoe',
        externalId: '99',
        authoritativeValues: koeiValues
      }
    ])

    const converged = planAuthoritativeNextmoeCompanyEvidence({
      companies: [
        company(12, 'KOEI Co., Ltd.', {
          normalizedName: 'koei co., ltd.',
          externalIds: [{ source: 'nextmoe', externalId: '99' }],
          identities: [
            {
              kind: 'name',
              origin: 'authoritative',
              value: 'KOEI Co., Ltd.',
              normalizedValue: 'koei co., ltd.'
            },
            {
              kind: 'alias',
              origin: 'authoritative',
              value: 'コーエー',
              normalizedValue: 'コーエー'
            }
          ]
        })
      ],
      candidates: [nextmoeCandidate(12, '99', 'KOEI Co., Ltd.', koeiValues)]
    })
    expect(converged).toEqual({ actions: [], warnings: [] })
  })
})

describe('authoritative alias merge planning', () => {
  it('auto-merges only a main name covered by one authoritative alias', () => {
    const result = buildAuthoritativeAliasCompanyMergePlan([
      company(1, 'Palette', {
        identities: [
          {
            kind: 'alias',
            origin: 'authoritative',
            value: 'ぱれっと',
            normalizedValue: 'ぱれっと'
          },
          {
            kind: 'alias',
            origin: 'legacy',
            value: 'Legacy Studio',
            normalizedValue: 'legacy studio'
          }
        ]
      }),
      company(2, 'ぱれっと', { normalizedName: 'ぱれっと' }),
      company(3, 'Legacy Studio', { normalizedName: 'legacy studio' })
    ])

    expect(result.merges).toEqual([
      {
        targetCompanyId: 1,
        targetName: 'Palette',
        sourceCompanyIds: [2],
        sourceNames: ['ぱれっと']
      }
    ])
  })

  it('warns instead of merging when an authoritative alias has multiple owners', () => {
    const companies = [
      company(1, 'First', {
        identities: [
          {
            kind: 'alias',
            origin: 'authoritative',
            value: 'Shared',
            normalizedValue: 'shared'
          }
        ]
      }),
      company(2, 'Second', {
        identities: [
          {
            kind: 'alias',
            origin: 'authoritative',
            value: 'Shared',
            normalizedValue: 'shared'
          }
        ]
      }),
      company(3, 'Shared', { normalizedName: 'shared' })
    ]

    const result = buildAuthoritativeAliasCompanyMergePlan(companies)
    expect(result.merges).toEqual([])
    expect(result.warnings[0]).toContain('Skip ambiguous company')
  })
})

/**
 * Production dirty data: one work lists several spellings and several catalog
 * companies. NextMoe evidence is resolved per catalog company, so only the
 * spellings carried by the same catalog company merge into each other.
 */
describe('NextMoe evidence across production name variants', () => {
  const mebiusCatalogValues = [
    'Mebius',
    'Mebius（株式会社メビウス）',
    'mebius',
    '株式会社メビウス'
  ]

  // 'Mebius' and 'mebius' normalize alike, so evidence keeps the last spelling
  // the catalog returned for that value.
  const mebiusAuthoritativeValues = [
    'mebius',
    'Mebius（株式会社メビウス）',
    '株式会社メビウス'
  ]

  const mebiusCompanies = () => [
    company(1, 'Mebius', {
      normalizedName: normalizeCompanyValue('Mebius'),
      count: 3
    }),
    company(2, 'Mebius（株式会社メビウス）', {
      normalizedName: normalizeCompanyValue('Mebius（株式会社メビウス）'),
      count: 1
    }),
    company(3, 'mebius', {
      normalizedName: normalizeCompanyValue('mebius'),
      count: 1
    })
  ]

  it('merges every mebius spelling into the highest-count company', () => {
    const companies = mebiusCompanies()
    const evidence = planAuthoritativeNextmoeCompanyEvidence({
      companies,
      candidates: companies.map((row) =>
        nextmoeCandidate(row.id, 'mebius-cat', 'Mebius', mebiusCatalogValues)
      )
    })

    expect(evidence.actions).toEqual([
      {
        companyId: 1,
        source: 'nextmoe',
        externalId: 'mebius-cat',
        authoritativeValues: mebiusAuthoritativeValues
      }
    ])
    expect(
      buildAuthoritativeAliasCompanyMergePlan(companies, evidence.actions)
        .merges
    ).toEqual([
      {
        targetCompanyId: 1,
        targetName: 'Mebius',
        sourceCompanyIds: [3, 2],
        sourceNames: ['mebius', 'Mebius（株式会社メビウス）']
      }
    ])
  })

  it('keeps two catalog companies from the same work apart', () => {
    const companies = [
      company(1, 'Mebius', {
        normalizedName: normalizeCompanyValue('Mebius'),
        count: 3
      }),
      company(2, 'Cherrymochi', {
        normalizedName: normalizeCompanyValue('Cherrymochi'),
        count: 1
      })
    ]
    const evidence = planAuthoritativeNextmoeCompanyEvidence({
      companies,
      candidates: [
        nextmoeCandidate(1, 'mebius-cat', 'Mebius', mebiusCatalogValues),
        nextmoeCandidate(2, 'cherrymochi-cat', 'Cherrymochi', ['Cherrymochi'])
      ]
    })

    expect(evidence.actions).toEqual([
      {
        companyId: 1,
        source: 'nextmoe',
        externalId: 'mebius-cat',
        authoritativeValues: mebiusAuthoritativeValues
      },
      {
        companyId: 2,
        source: 'nextmoe',
        externalId: 'cherrymochi-cat',
        authoritativeValues: ['Cherrymochi']
      }
    ])
    expect(
      buildAuthoritativeAliasCompanyMergePlan(companies, evidence.actions)
        .merges
    ).toEqual([])
  })

  it('merges the Tenky spelling into its catalog company', () => {
    const companies = [
      company(1, 'Tenky', {
        normalizedName: normalizeCompanyValue('Tenky'),
        count: 1
      }),
      company(2, 'テンキー', {
        normalizedName: normalizeCompanyValue('テンキー'),
        count: 1
      })
    ]
    const evidence = planAuthoritativeNextmoeCompanyEvidence({
      companies,
      candidates: companies.map((row) =>
        nextmoeCandidate(row.id, 'tenky-cat', 'Tenky', ['Tenky', 'テンキー'])
      )
    })

    expect(evidence.actions).toEqual([
      {
        companyId: 1,
        source: 'nextmoe',
        externalId: 'tenky-cat',
        authoritativeValues: ['Tenky', 'テンキー']
      }
    ])
    expect(
      buildAuthoritativeAliasCompanyMergePlan(companies, evidence.actions)
        .merges
    ).toEqual([
      {
        targetCompanyId: 1,
        targetName: 'Tenky',
        sourceCompanyIds: [2],
        sourceNames: ['テンキー']
      }
    ])
  })

  it('keeps the KONAMI publisher out of the Tenky developer', () => {
    const companies = [
      company(1, 'KONAMI', {
        normalizedName: normalizeCompanyValue('KONAMI'),
        count: 5
      }),
      company(2, 'テンキー', {
        normalizedName: normalizeCompanyValue('テンキー'),
        count: 1
      })
    ]
    const evidence = planAuthoritativeNextmoeCompanyEvidence({
      companies,
      candidates: [
        nextmoeCandidate(1, 'konami-cat', 'KONAMI', ['KONAMI']),
        nextmoeCandidate(2, 'tenky-cat', 'Tenky', ['Tenky', 'テンキー'])
      ]
    })

    expect(evidence.actions).toEqual([
      {
        companyId: 1,
        source: 'nextmoe',
        externalId: 'konami-cat',
        authoritativeValues: ['KONAMI']
      },
      {
        companyId: 2,
        source: 'nextmoe',
        externalId: 'tenky-cat',
        authoritativeValues: ['Tenky', 'テンキー']
      }
    ])
    expect(
      buildAuthoritativeAliasCompanyMergePlan(companies, evidence.actions)
        .merges
    ).toEqual([])
  })
})
