import { beforeEach, describe, expect, it, vi } from 'vitest'

const addRelationsMock = vi.hoisted(() => vi.fn())
const syncProjectionMock = vi.hoisted(() => vi.fn())

vi.mock('~/app/api/edit/companyRelationHelper', () => ({
  addPatchCompanyRelations: addRelationsMock
}))
vi.mock('~/app/api/company/identity/projection', () => ({
  syncCompanyIdentityProjection: syncProjectionMock
}))

import {
  CompanyResolutionAmbiguityError,
  applyCompanyResolution,
  planCompanyResolution,
  selectCanonicalCompanyName
} from '~/app/api/company/identity/resolver'
import type {
  CompanyCandidate,
  CompanyRole,
  TrustedCompanyCandidate
} from '~/app/api/company/identity/types'

const candidate = (
  name: string,
  options: Partial<CompanyCandidate> & {
    trust?: TrustedCompanyCandidate['trust']
  } = {}
): TrustedCompanyCandidate => ({
  trust: options.trust ?? 'unverified',
  candidate: {
    source: options.source ?? 'steam',
    externalId: options.externalId ?? '',
    name,
    aliases: options.aliases ?? [],
    roles: options.roles ?? ['unknown'],
    sourceRoles: options.sourceRoles ?? [],
    entityType: options.entityType ?? 'unknown',
    externalUrls: options.externalUrls ?? [],
    primaryLanguage: options.primaryLanguage ?? '',
    sourceWebsites: options.sourceWebsites ?? []
  }
})

const company = (id: number, name: string, normalizedName?: string) => ({
  id,
  name,
  normalized_name: normalizedName ?? name.toLowerCase()
})

const resolutionDb = (
  input: {
    companies?: ReturnType<typeof company>[]
    identities?: Array<{
      origin: 'authoritative' | 'legacy'
      value: string
      normalized_value: string
      company: { id: number; name: string }
    }>
    externalIdentities?: Array<{
      source: string
      external_id: string
      company: { id: number; name: string }
    }>
  } = {}
) => ({
  patch_company: {
    findMany: vi.fn().mockResolvedValue(input.companies ?? [])
  },
  patch_company_name_identity: {
    findMany: vi.fn().mockResolvedValue(input.identities ?? [])
  },
  patch_company_external_id: {
    findMany: vi.fn().mockResolvedValue(input.externalIdentities ?? [])
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  addRelationsMock.mockResolvedValue([])
  syncProjectionMock.mockResolvedValue({
    normalizedNameUpdated: 0,
    created: 0,
    updated: 0,
    deleted: 0
  })
})

describe('company identity resolver planning', () => {
  it('uses a verified external id before a conflicting normalized name', async () => {
    const trusted = candidate('Name B', {
      trust: 'verified',
      source: 'vndb',
      externalId: 'p1'
    })
    const plan = await planCompanyResolution(
      resolutionDb({
        companies: [company(2, 'Name B', 'name b')],
        externalIdentities: [
          {
            source: 'vndb',
            external_id: 'p1',
            company: { id: 1, name: 'Name A' }
          }
        ]
      }) as never,
      [trusted]
    )

    expect(plan.resolvedExisting).toEqual([
      expect.objectContaining({ companyId: 1, matchedBy: 'external-id' })
    ])
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        reason: 'external-id-name-conflict',
        matchedCompanies: [
          { id: 1, name: 'Name A' },
          { id: 2, name: 'Name B' }
        ]
      })
    ])
    expect(plan.ambiguities).toEqual([])
  })

  it('walks normalized name, authoritative alias and exact legacy alias in order', async () => {
    const db = resolutionDb({
      companies: [company(1, 'Main', 'main')],
      identities: [
        {
          origin: 'authoritative',
          value: 'Auth Alias',
          normalized_value: 'auth alias',
          company: { id: 2, name: 'Authoritative' }
        },
        {
          origin: 'legacy',
          value: 'Legacy Exact',
          normalized_value: 'legacy exact',
          company: { id: 3, name: 'Legacy' }
        }
      ]
    })
    const plan = await planCompanyResolution(db as never, [
      candidate('ＭＡＩＮ'),
      candidate('AUTH ALIAS'),
      candidate('Legacy Exact')
    ])

    expect(
      plan.resolvedExisting.map((resolution) => [
        resolution.companyId,
        resolution.matchedBy
      ])
    ).toEqual([
      [1, 'normalized-name'],
      [2, 'normalized-alias'],
      [3, 'normalized-alias']
    ])
  })

  it('does not broaden a legacy alias through normalization', async () => {
    const plan = await planCompanyResolution(
      resolutionDb({
        identities: [
          {
            origin: 'legacy',
            value: 'Legacy Alias',
            normalized_value: 'legacy alias',
            company: { id: 3, name: 'Legacy' }
          }
        ]
      }) as never,
      [candidate('ＬＥＧＡＣＹ　ＡＬＩＡＳ')]
    )

    expect(plan.resolvedExisting).toEqual([])
    expect(plan.wouldCreate).toHaveLength(1)
  })

  it('merges same-batch spellings transitively and ignores roles', async () => {
    const roles: CompanyRole[][] = [['developer'], ['publisher'], ['circle']]
    const candidates = [
      candidate('Whirlpool', {
        trust: 'verified',
        source: 'vndb',
        aliases: ['Palette'],
        roles: roles[0]
      }),
      candidate('ＰＡＬＥＴＴＥ', { source: 'bangumi', roles: roles[1] }),
      candidate('Palette', { source: 'dlsite', roles: roles[2] })
    ]
    const plan = await planCompanyResolution(
      resolutionDb() as never,
      candidates
    )

    expect(plan.wouldCreate).toEqual([candidates])
  })

  it('uses a batch match when one spelling reaches an existing company', async () => {
    const plan = await planCompanyResolution(
      resolutionDb({ companies: [company(1, 'Palette', 'palette')] }) as never,
      [
        candidate('Whirlpool', {
          trust: 'verified',
          source: 'vndb',
          aliases: ['Palette']
        }),
        candidate('Whirlpool')
      ]
    )

    expect(plan.resolvedExisting).toEqual([
      expect.objectContaining({ companyId: 1, matchedBy: 'batch' })
    ])
  })

  it('lets a verified external id break a lower-strength shared-alias ambiguity in the same batch', async () => {
    const plan = await planCompanyResolution(
      resolutionDb({
        identities: [
          {
            origin: 'authoritative',
            value: 'Shared',
            normalized_value: 'shared',
            company: { id: 1, name: 'First' }
          },
          {
            origin: 'authoritative',
            value: 'Shared',
            normalized_value: 'shared',
            company: { id: 2, name: 'Second' }
          }
        ],
        externalIdentities: [
          {
            source: 'vndb',
            external_id: 'p1',
            company: { id: 1, name: 'First' }
          }
        ]
      }) as never,
      [
        candidate('Shared', {
          trust: 'verified',
          source: 'vndb',
          externalId: 'p1'
        }),
        candidate('Shared', { source: 'steam' })
      ]
    )

    expect(plan.resolvedExisting).toEqual([
      expect.objectContaining({ companyId: 1, matchedBy: 'external-id' })
    ])
    expect(plan.ambiguities).toEqual([])
  })

  it('reports same-strength and duplicate external-id conflicts instead of picking the first row', async () => {
    const aliasConflict = await planCompanyResolution(
      resolutionDb({
        identities: [
          {
            origin: 'authoritative',
            value: 'Shared',
            normalized_value: 'shared',
            company: { id: 1, name: 'First' }
          },
          {
            origin: 'authoritative',
            value: 'Shared',
            normalized_value: 'shared',
            company: { id: 2, name: 'Second' }
          }
        ]
      }) as never,
      [candidate('Shared')]
    )
    expect(aliasConflict.ambiguities[0]).toMatchObject({
      reason: 'multiple-companies'
    })

    const externalConflict = await planCompanyResolution(
      resolutionDb({
        externalIdentities: [
          {
            source: 'vndb',
            external_id: 'p1',
            company: { id: 1, name: 'First' }
          },
          {
            source: 'vndb',
            external_id: 'p1',
            company: { id: 2, name: 'Second' }
          }
        ]
      }) as never,
      [
        candidate('Producer', {
          trust: 'verified',
          source: 'vndb',
          externalId: 'p1'
        })
      ]
    )
    expect(externalConflict.ambiguities[0]).toMatchObject({
      reason: 'conflicting-external-id'
    })
  })

  it('selects a VNDB native name before its romanized name', () => {
    expect(
      selectCanonicalCompanyName([
        candidate('Palette', {
          trust: 'verified',
          source: 'vndb',
          aliases: ['ぱれっと'],
          primaryLanguage: 'ja'
        }),
        candidate('Palette')
      ])
    ).toBe('ぱれっと')
  })
})

describe('company identity resolver apply', () => {
  const applyTx = (input: Parameters<typeof resolutionDb>[0] = {}) => {
    const read = resolutionDb(input)
    return {
      ...read,
      $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
      patch_company: {
        ...read.patch_company,
        findUnique: vi.fn().mockResolvedValue({ name: 'Name A', alias: [] }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 9, name: 'New Company' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      patch_company_name_identity: {
        ...read.patch_company_name_identity,
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      patch_company_external_id: {
        ...read.patch_company_external_id,
        create: vi.fn().mockResolvedValue({})
      }
    }
  }

  it('creates authoritative evidence only from verified candidates', async () => {
    const tx = applyTx()
    addRelationsMock.mockResolvedValue([9])
    await applyCompanyResolution(
      tx as never,
      5,
      [
        candidate('New Company', {
          trust: 'unverified',
          source: 'steam',
          externalId: 'forged',
          aliases: ['Forged Alias'],
          sourceWebsites: ['https://example.test']
        })
      ],
      100
    )

    expect(tx.patch_company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ alias: [] })
      })
    )
    expect(tx.patch_company_external_id.create).not.toHaveBeenCalled()
    expect(addRelationsMock).toHaveBeenCalledWith(tx, 5, [9])
  })

  it('persists verified aliases and external ids for a new company', async () => {
    const tx = applyTx()
    await applyCompanyResolution(
      tx as never,
      5,
      [
        candidate('Palette', {
          trust: 'verified',
          source: 'vndb',
          externalId: 'p1',
          aliases: ['ぱれっと'],
          sourceWebsites: ['https://example.test']
        })
      ],
      100
    )

    expect(tx.patch_company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Palette',
          alias: ['ぱれっと'],
          official_website: ['https://example.test']
        })
      })
    )
    expect(tx.patch_company_external_id.create).toHaveBeenCalledWith({
      data: {
        company_id: 9,
        source: 'vndb',
        external_id: 'p1'
      }
    })
  })

  it('does not add a conflicting candidate name as an alias', async () => {
    const tx = applyTx({
      companies: [company(2, 'Name B', 'name b')],
      externalIdentities: [
        {
          source: 'vndb',
          external_id: 'p1',
          company: { id: 1, name: 'Name A' }
        }
      ]
    })
    tx.patch_company_external_id.findMany
      .mockResolvedValueOnce([
        {
          source: 'vndb',
          external_id: 'p1',
          company: { id: 1, name: 'Name A' }
        }
      ])
      .mockResolvedValueOnce([
        { company_id: 1, source: 'vndb', external_id: 'p1' }
      ])

    const result = await applyCompanyResolution(
      tx as never,
      5,
      [
        candidate('Name B', {
          trust: 'verified',
          source: 'vndb',
          externalId: 'p1'
        })
      ],
      100
    )

    expect(tx.patch_company.update).not.toHaveBeenCalled()
    expect(result.diagnostics).toHaveLength(1)
  })

  it('stops before all writes when the plan is ambiguous', async () => {
    const tx = applyTx({
      identities: [
        {
          origin: 'authoritative',
          value: 'Shared',
          normalized_value: 'shared',
          company: { id: 1, name: 'First' }
        },
        {
          origin: 'authoritative',
          value: 'Shared',
          normalized_value: 'shared',
          company: { id: 2, name: 'Second' }
        }
      ]
    })

    await expect(
      applyCompanyResolution(tx as never, 5, [candidate('Shared')], 100)
    ).rejects.toBeInstanceOf(CompanyResolutionAmbiguityError)
    expect(tx.patch_company.create).not.toHaveBeenCalled()
    expect(addRelationsMock).not.toHaveBeenCalled()
  })
})
