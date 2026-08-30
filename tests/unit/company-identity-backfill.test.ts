import { describe, expect, it, vi } from 'vitest'
import {
  buildCompanyIdentityProjection,
  planCompanyIdentityProjection,
  syncCompanyIdentityProjection
} from '~/app/api/company/identity/projection'
import {
  runCompanyIdentityBackfill,
  type CompanyIdentityBackfillCompany
} from '~/migration/backfillCompanyIdentities'

describe('company identity projection', () => {
  it('deduplicates aliases inside one company and marks historical aliases legacy', () => {
    expect(
      buildCompanyIdentityProjection({
        name: 'Palette',
        aliases: [' ぱれっと ', 'ＰＡＬＥＴＴＥ', 'Palette']
      })
    ).toEqual({
      normalizedName: 'palette',
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: 'Palette',
          normalizedValue: 'palette'
        },
        {
          kind: 'alias',
          origin: 'legacy',
          value: 'ぱれっと',
          normalizedValue: 'ぱれっと'
        },
        {
          kind: 'alias',
          origin: 'legacy',
          value: 'ＰＡＬＥＴＴＥ',
          normalizedValue: 'palette'
        }
      ]
    })
  })

  it('allows the same alias to remain represented by different companies', () => {
    const first = buildCompanyIdentityProjection({
      name: 'First',
      aliases: ['Shared']
    })
    const second = buildCompanyIdentityProjection({
      name: 'Second',
      aliases: ['Shared']
    })

    expect(first.identities.at(-1)?.normalizedValue).toBe('shared')
    expect(second.identities.at(-1)?.normalizedValue).toBe('shared')
  })

  it('promotes a retained manual alias without downgrading authoritative data during backfill', () => {
    const legacyIdentity = {
      id: 2,
      kind: 'alias',
      origin: 'legacy',
      value: 'Alias',
      normalizedValue: 'alias',
      confirmedByUserId: null
    }
    const current = {
      normalizedName: 'studio',
      identities: [
        {
          id: 1,
          kind: 'name',
          origin: 'authoritative',
          value: 'Studio',
          normalizedValue: 'studio',
          confirmedByUserId: null
        },
        legacyIdentity
      ]
    }

    expect(
      planCompanyIdentityProjection(
        {
          name: 'Studio',
          aliases: ['Alias'],
          aliasOrigin: 'authoritative'
        },
        current
      ).toUpdate
    ).toEqual([{ id: 2, value: 'Alias', makeAuthoritative: true }])

    expect(
      planCompanyIdentityProjection(
        { name: 'Studio', aliases: ['Alias'], aliasOrigin: 'legacy' },
        {
          ...current,
          identities: [
            current.identities[0],
            { ...legacyIdentity, origin: 'authoritative' }
          ]
        }
      ).toUpdate
    ).toEqual([])
  })

  it('rejects historical values that cannot fit both identity columns', () => {
    expect(() =>
      buildCompanyIdentityProjection({
        name: 'Studio',
        aliases: ['ﬃ'.repeat(107)]
      })
    ).toThrow('Company alias cannot fit the identity columns')
  })

  it('does no writes on an idempotent second synchronization', async () => {
    let normalizedName: string | null = null
    let nextId = 1
    const identities: Array<{
      id: number
      kind: string
      origin: string
      value: string
      normalized_value: string
      confirmed_by_user_id: number | null
    }> = []
    const tx = {
      patch_company: {
        findUnique: vi.fn(async () => ({
          name: 'Palette',
          alias: ['ぱれっと', 'Palette'],
          normalized_name: normalizedName,
          name_identities: identities.map((identity) => ({ ...identity }))
        })),
        update: vi.fn(
          async ({ data }: { data: { normalized_name: string } }) => {
            normalizedName = data.normalized_name
            return {}
          }
        )
      },
      $queryRaw: vi.fn(async () => [{ id: 1 }]),
      patch_company_name_identity: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async () => ({})),
        createMany: vi.fn(
          async ({ data }: { data: Array<Record<string, unknown>> }) => {
            for (const identity of data) {
              identities.push({
                id: nextId++,
                kind: String(identity.kind),
                origin: String(identity.origin),
                value: String(identity.value),
                normalized_value: String(identity.normalized_value),
                confirmed_by_user_id: null
              })
            }
            return { count: data.length }
          }
        )
      }
    }
    const input = { companyId: 1 }

    await expect(
      syncCompanyIdentityProjection(tx as never, input)
    ).resolves.toMatchObject({ normalizedNameUpdated: 1, created: 3 })
    vi.clearAllMocks()
    await expect(
      syncCompanyIdentityProjection(tx as never, input)
    ).resolves.toEqual({
      normalizedNameUpdated: 0,
      created: 0,
      updated: 0,
      deleted: 0
    })
    expect(tx.patch_company.update).not.toHaveBeenCalled()
    expect(tx.patch_company_name_identity.createMany).not.toHaveBeenCalled()
    expect(tx.patch_company_name_identity.update).not.toHaveBeenCalled()
    expect(tx.patch_company_name_identity.deleteMany).not.toHaveBeenCalled()
  })
})

describe('company identity backfill runner', () => {
  const companies: CompanyIdentityBackfillCompany[] = [
    {
      id: 1,
      name: 'First',
      alias: ['Alias'],
      normalizedName: null,
      identities: []
    },
    {
      id: 2,
      name: 'Second',
      alias: ['Alias'],
      normalizedName: null,
      identities: []
    }
  ]

  it('is dry by default and writes each company only in apply mode', async () => {
    const syncCompany = vi.fn().mockResolvedValue({
      normalizedNameUpdated: 1,
      created: 2,
      updated: 0,
      deleted: 0
    })
    const loadCompanies = vi.fn(async (afterId: number) =>
      companies.filter((company) => company.id > afterId)
    )
    const dependencies = {
      loadCompanies,
      syncCompany,
      close: vi.fn()
    }

    const dry = await runCompanyIdentityBackfill(
      { apply: false, batchSize: 200 },
      dependencies
    )
    expect(dry.scanned).toBe(2)
    expect(dry.reconciled).toBe(2)
    expect(dry.identitiesCreated).toBe(4)
    expect(syncCompany).not.toHaveBeenCalled()

    const applied = await runCompanyIdentityBackfill(
      { apply: true, batchSize: 200 },
      dependencies
    )
    expect(applied).toMatchObject({
      scanned: 2,
      reconciled: 2,
      normalizedNamesUpdated: 2,
      identitiesCreated: 4
    })
    expect(syncCompany).toHaveBeenCalledTimes(2)
  })

  it('reports no reconciliation on an idempotent second pass', async () => {
    const syncCompany = vi
      .fn()
      .mockResolvedValueOnce({
        normalizedNameUpdated: 1,
        created: 2,
        updated: 0,
        deleted: 0
      })
      .mockResolvedValueOnce({
        normalizedNameUpdated: 0,
        created: 0,
        updated: 0,
        deleted: 0
      })
    const dependencies = {
      loadCompanies: vi.fn(async (afterId: number) =>
        afterId === 0 ? [companies[0]] : []
      ),
      syncCompany,
      close: vi.fn()
    }

    const first = await runCompanyIdentityBackfill(
      { apply: true, batchSize: 200 },
      dependencies
    )
    const second = await runCompanyIdentityBackfill(
      { apply: true, batchSize: 200 },
      dependencies
    )

    expect(first.reconciled).toBe(1)
    expect(second.reconciled).toBe(0)
  })
})
