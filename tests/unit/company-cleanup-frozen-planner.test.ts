import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMPANY_CLEANUP_SCHEMA_VERSION,
  readPlanWithVerifiedSidecar,
  writeCanonicalArtifact,
  type CompanyDatabaseState
} from '~/scripts/companyCleanupFrozenContract'
import { validateFrozenPlanSimulation } from '~/scripts/companyCleanupFrozenApply'
import {
  buildCompanyInventory,
  fetchNextmoeEvidence,
  finalizeFrozenCompanyCleanupPlan,
  generateFrozenCompanyCleanupPlan
} from '~/scripts/companyCleanupFrozenPlanner'
import {
  digestSemanticCompanyDatabaseState,
  getCompanyOwnerRef,
  getCompanyRef
} from '~/scripts/companyCleanupFrozenState'

const temporaryDirectories: string[] = []
const originalNextmoeApiKey = process.env.KUN_NEXTMOE_API_KEY

beforeEach(() => {
  delete process.env.KUN_NEXTMOE_API_KEY
})

afterEach(async () => {
  if (originalNextmoeApiKey === undefined) {
    delete process.env.KUN_NEXTMOE_API_KEY
  } else {
    process.env.KUN_NEXTMOE_API_KEY = originalNextmoeApiKey
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const state = (withVndbRelation = false): CompanyDatabaseState => ({
  companies: [
    {
      id: 1,
      ref: getCompanyRef({
        id: 1,
        name: 'Palette',
        normalizedName: 'palette'
      }),
      name: 'Palette',
      normalizedName: 'palette',
      introduction: '',
      count: withVndbRelation ? 1 : 0,
      primaryLanguage: ['ja'],
      sourceWebsites: [],
      parentBrands: [],
      aliases: [],
      ownerRef: getCompanyOwnerRef(42),
      updated: '2026-08-31T00:00:00.000Z',
      externalIds: [],
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: 'Palette',
          normalizedValue: 'palette',
          confirmedByRef: null
        }
      ],
      relations: withVndbRelation
        ? [
            {
              patchId: 10,
              patchUniqueId: 'patch-10',
              vndbId: 'v10',
              bangumiId: null
            }
          ]
        : []
    }
  ]
})

const manualMergeState = (): CompanyDatabaseState => {
  const snapshot = state(true)
  snapshot.companies.push({
    id: 2,
    ref: getCompanyRef({
      id: 2,
      name: 'Palette Legacy',
      normalizedName: 'palette legacy'
    }),
    name: 'Palette Legacy',
    normalizedName: 'palette legacy',
    introduction: 'Legacy introduction',
    count: 1,
    primaryLanguage: ['ja'],
    sourceWebsites: [],
    parentBrands: [],
    aliases: [],
    ownerRef: getCompanyOwnerRef(42),
    updated: '2026-08-31T00:00:00.000Z',
    externalIds: [],
    identities: [
      {
        kind: 'name',
        origin: 'legacy',
        value: 'Palette Legacy',
        normalizedValue: 'palette legacy',
        confirmedByRef: null
      }
    ],
    relations: [
      { patchId: 11, patchUniqueId: 'patch-11', vndbId: 'v11', bangumiId: null }
    ]
  })
  return snapshot
}

const toRows = (snapshot: CompanyDatabaseState) =>
  snapshot.companies.map((company) => ({
    id: company.id,
    name: company.name,
    normalized_name: company.normalizedName,
    introduction: company.introduction,
    count: company.count,
    primary_language: company.primaryLanguage,
    official_website: company.sourceWebsites,
    parent_brand: company.parentBrands,
    alias: company.aliases,
    user_id: 42,
    updated: new Date(company.updated),
    external_ids: [],
    name_identities: company.identities.map((identity, index) => ({
      id: index + 1,
      kind: identity.kind,
      origin: identity.origin,
      value: identity.value,
      normalized_value: identity.normalizedValue,
      confirmed_by_user_id: null
    })),
    patch_relations: company.relations.map((relation, index) => ({
      id: index + 1,
      patch_id: relation.patchId,
      patch: {
        unique_id: relation.patchUniqueId,
        vndb_id: relation.vndbId,
        bangumi_id: relation.bangumiId
      }
    }))
  }))

const prepareArtifacts = async (
  snapshot: CompanyDatabaseState,
  merges: Array<{
    targetCompanyRef: string
    sourceCompanyRefs: string[]
    ownerFromCompanyRef: string
    introductionFromCompanyRef: string
    reason: string
  }> = []
) => {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), 'kun-company-plan-')
  )
  temporaryDirectories.push(directory)
  await chmod(directory, 0o700)
  const inventoryPath = join(directory, 'inventory.json')
  const decisionsPath = join(directory, 'decisions.json')
  const outputPath = join(directory, 'plan.json')
  const inventorySha256 = await writeCanonicalArtifact(
    inventoryPath,
    buildCompanyInventory(snapshot),
    { sidecar: true }
  )
  await writeCanonicalArtifact(decisionsPath, {
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    inventorySha256,
    merges,
    deletions: []
  })
  return { inventoryPath, decisionsPath, outputPath }
}

const database = (snapshots: CompanyDatabaseState[]) => {
  let index = 0
  return {
    patch_company: {
      findMany: vi.fn(() => {
        const snapshot = snapshots[Math.min(index, snapshots.length - 1)]
        index += 1
        return Promise.resolve(toRows(snapshot))
      })
    }
  }
}

const nextmoeState = (): CompanyDatabaseState => ({
  companies: [
    {
      id: 12,
      ref: getCompanyRef({
        id: 12,
        name: 'KOEI Co., Ltd.',
        normalizedName: 'koei co., ltd.'
      }),
      name: 'KOEI Co., Ltd.',
      normalizedName: 'koei co., ltd.',
      introduction: '',
      count: 5,
      primaryLanguage: ['ja'],
      sourceWebsites: [],
      parentBrands: [],
      aliases: [],
      ownerRef: getCompanyOwnerRef(42),
      updated: '2026-08-31T00:00:00.000Z',
      externalIds: [],
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: 'KOEI Co., Ltd.',
          normalizedValue: 'koei co., ltd.',
          confirmedByRef: null
        }
      ],
      relations: [
        {
          patchId: 20,
          patchUniqueId: 'patch-20',
          vndbId: 'v2168',
          bangumiId: 21041
        }
      ]
    },
    {
      id: 34,
      ref: getCompanyRef({
        id: 34,
        name: 'コーエー',
        normalizedName: 'コーエー'
      }),
      name: 'コーエー',
      normalizedName: 'コーエー',
      introduction: '',
      count: 1,
      primaryLanguage: ['ja'],
      sourceWebsites: [],
      parentBrands: [],
      aliases: [],
      ownerRef: getCompanyOwnerRef(42),
      updated: '2026-08-31T00:00:00.000Z',
      externalIds: [],
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: 'コーエー',
          normalizedValue: 'コーエー',
          confirmedByRef: null
        }
      ],
      relations: [
        {
          patchId: 21,
          patchUniqueId: 'patch-21',
          vndbId: null,
          bangumiId: 21041
        }
      ]
    }
  ]
})

const nextmoeFetchers = () => ({
  fetchNextmoeWorks: vi.fn(async (refs: string[]) => ({
    object: 'list' as const,
    items: refs.map((ref) => ({
      object: 'work',
      id: `work:${ref}`,
      companies: [
        { object: 'company', id: '99', display_name: 'KOEI Co., Ltd.' }
      ]
    })),
    missing: []
  })),
  fetchNextmoeCompanies: vi.fn(async (ids: string[]) => ({
    object: 'list' as const,
    items: ids.map((id) => ({
      object: 'company',
      id,
      display_name: 'KOEI Co., Ltd.',
      aliases: [
        { value: 'コーエー', lang: 'ja' },
        { value: '光栄', lang: 'ja', is_machine: true }
      ]
    })),
    missing: []
  })),
  pauseNextmoeBatches: async () => undefined
})

describe('frozen company cleanup planner', () => {
  it('refuses to write a plan when snapshot B differs from snapshot A', async () => {
    const snapshotA = state()
    const snapshotB = structuredClone(snapshotA)
    snapshotB.companies[0].introduction = 'concurrent change'
    const paths = await prepareArtifacts(snapshotA)

    await expect(
      generateFrozenCompanyCleanupPlan({
        db: database([snapshotA, snapshotB]) as never,
        ...paths,
        fetchVndbCandidates: vi.fn()
      })
    ).rejects.toThrow('changed while external company evidence was fetched')
  })

  it('freezes a VNDB fetch failure as a blocker instead of applying partial evidence', async () => {
    const snapshot = state(true)
    const paths = await prepareArtifacts(snapshot)
    const fetchVndbCandidates = vi
      .fn()
      .mockRejectedValueOnce(new Error('VNDB unavailable'))

    const result = await generateFrozenCompanyCleanupPlan({
      db: database([snapshot, snapshot]) as never,
      ...paths,
      fetchVndbCandidates
    })

    expect(fetchVndbCandidates).toHaveBeenCalledWith('v10')
    expect(result.plan.blockers).toContainEqual(
      expect.stringContaining('External evidence is incomplete')
    )
    expect(result.plan.evidenceActions).toEqual([])
  })

  it('builds a reviewed manual-only plan without VNDB or automatic evidence', async () => {
    const snapshot = manualMergeState()
    const target = snapshot.companies[0]
    const source = snapshot.companies[1]
    const paths = await prepareArtifacts(snapshot, [
      {
        targetCompanyRef: target.ref,
        sourceCompanyRefs: [source.ref],
        ownerFromCompanyRef: target.ref,
        introductionFromCompanyRef: source.ref,
        reason: 'Reviewed production duplicate'
      }
    ])
    const fetchVndbCandidates = vi.fn(() => {
      throw new Error('manual-only planning must not access VNDB')
    })
    const fetchers = nextmoeFetchers()

    const result = await generateFrozenCompanyCleanupPlan({
      db: database([snapshot, snapshot]) as never,
      ...paths,
      manualOnly: true,
      fetchVndbCandidates,
      ...fetchers
    })

    expect(fetchVndbCandidates).not.toHaveBeenCalled()
    expect(fetchers.fetchNextmoeWorks).not.toHaveBeenCalled()
    expect(fetchers.fetchNextmoeCompanies).not.toHaveBeenCalled()
    expect(result.plan.evidenceActions).toEqual([])
    expect(result.plan.mergeActions).toHaveLength(1)
    expect(result.plan.mergeActions[0]).toMatchObject({
      kind: 'manual',
      targetCompanyId: target.id,
      sourceCompanyIds: [source.id]
    })
    expect(result.plan.limits.actions).toBe(1)
    expect(result.plan.warnings).toContain(
      'Manual-only plan: VNDB evidence and automatic merges were intentionally skipped'
    )

    const loaded = await readPlanWithVerifiedSidecar(paths.outputPath)
    expect(() => validateFrozenPlanSimulation(loaded.plan)).not.toThrow()
    expect(loaded.plan).toEqual(result.plan)

    const finalized = finalizeFrozenCompanyCleanupPlan({
      ...loaded.plan,
      expectedPostDatabaseDigest: '0'.repeat(64)
    })
    expect(finalized.expectedPostDatabaseDigest).toBe(
      digestSemanticCompanyDatabaseState(finalized.expectedPostState)
    )
  })

  it('plans without a configured NextMoe catalog instead of blocking', async () => {
    delete process.env.KUN_NEXTMOE_API_KEY
    const snapshot = state(true)
    const paths = await prepareArtifacts(snapshot)

    const result = await generateFrozenCompanyCleanupPlan({
      db: database([snapshot, snapshot]) as never,
      ...paths,
      fetchVndbCandidates: vi.fn(async () => [])
    })

    expect(result.plan.blockers).toEqual([])
    expect(result.plan.warnings).toContain('NextMoe catalog is not configured')
  })

  it('freezes a NextMoe fetch failure as a blocker instead of binding partial evidence', async () => {
    const snapshot = state(true)
    const paths = await prepareArtifacts(snapshot)
    const fetchers = nextmoeFetchers()
    fetchers.fetchNextmoeWorks.mockRejectedValueOnce(
      new Error('NextMoe unavailable')
    )

    const result = await generateFrozenCompanyCleanupPlan({
      db: database([snapshot, snapshot]) as never,
      ...paths,
      fetchVndbCandidates: vi.fn(async () => []),
      ...fetchers
    })

    expect(fetchers.fetchNextmoeWorks).toHaveBeenCalledWith(['vndb:v10'])
    expect(result.plan.blockers).toContainEqual(
      expect.stringContaining('External evidence is incomplete')
    )
    expect(result.plan.blockers).toContainEqual(
      expect.stringContaining('NextMoe unavailable')
    )
    expect(result.plan.evidenceActions).toEqual([])
  })

  it('binds one NextMoe catalog company and merges the absorbed company', async () => {
    const snapshot = nextmoeState()
    const paths = await prepareArtifacts(snapshot)
    const fetchers = nextmoeFetchers()

    const result = await generateFrozenCompanyCleanupPlan({
      db: database([snapshot, snapshot]) as never,
      ...paths,
      fetchVndbCandidates: vi.fn(async () => []),
      ...fetchers
    })

    expect(fetchers.fetchNextmoeWorks).toHaveBeenCalledWith([
      'vndb:v2168',
      'bangumi:21041'
    ])
    expect(fetchers.fetchNextmoeCompanies).toHaveBeenCalledWith(['99'])
    expect(result.plan.blockers).toEqual([])
    expect(result.plan.evidenceActions).toEqual([
      {
        companyId: 12,
        source: 'nextmoe',
        externalId: '99',
        authoritativeValues: ['KOEI Co., Ltd.', 'コーエー']
      }
    ])
    expect(result.plan.mergeActions).toMatchObject([
      { kind: 'automatic', targetCompanyId: 12, sourceCompanyIds: [34] }
    ])
    expect(result.plan.limits.actions).toBe(2)

    const postState = result.plan.expectedPostState
    expect(postState.companies.map((company) => company.id)).toEqual([12])
    const merged = postState.companies[0]
    expect(merged.name).toBe('KOEI Co., Ltd.')
    expect(merged.normalizedName).toBe('koei co., ltd.')
    expect(merged.externalIds).toContainEqual({
      source: 'nextmoe',
      externalId: '99'
    })
    expect(merged.aliases).toContain('コーエー')

    const relations = [...merged.relations].sort(
      (left, right) => left.patchId - right.patchId
    )
    expect(
      relations.map((relation) => [relation.patchId, relation.patchUniqueId])
    ).toEqual([
      [20, 'patch-20'],
      [21, 'patch-21']
    ])
    expect(relations.map((relation) => relation.vndbId)).toEqual([
      'v2168',
      null
    ])
    expect(relations.map((relation) => relation.bangumiId)).toEqual([
      21041, 21041
    ])

    // The simulated apply writes the merged relation map size, not the stale
    // pre-merge counter; production triggers are asserted separately.
    expect(merged.count).toBe(2)
    expect(() => validateFrozenPlanSimulation(result.plan)).not.toThrow()
  })
})

describe('NextMoe evidence fetching', () => {
  const relationState = (refs: string[]): CompanyDatabaseState => ({
    companies: [
      {
        id: 1,
        ref: getCompanyRef({
          id: 1,
          name: 'Palette',
          normalizedName: 'palette'
        }),
        name: 'Palette',
        normalizedName: 'palette',
        introduction: '',
        count: refs.length,
        primaryLanguage: [],
        sourceWebsites: [],
        parentBrands: [],
        aliases: [],
        ownerRef: getCompanyOwnerRef(42),
        updated: '2026-08-31T00:00:00.000Z',
        externalIds: [],
        identities: [],
        relations: refs.map((ref, index) => ({
          patchId: index + 1,
          patchUniqueId: `patch-${index + 1}`,
          vndbId: `v${ref}`,
          bangumiId: null
        }))
      }
    ]
  })

  it('collects relation refs in batches of one hundred with a pause between them', async () => {
    const refs = Array.from({ length: 101 }, (_, index) => String(index + 1))
    const pauseBetweenBatches = vi.fn(async () => undefined)
    const fetchNextmoeWorks = vi.fn(async (_refs: string[]) => ({
      object: 'list' as const,
      items: [],
      missing: []
    }))

    const result = await fetchNextmoeEvidence({
      state: relationState(refs),
      fetchNextmoeWorks,
      fetchNextmoeCompanies: vi.fn(async () => ({
        object: 'list' as const,
        items: [],
        missing: []
      })),
      pauseBetweenBatches
    })

    expect(fetchNextmoeWorks.mock.calls.map(([batch]) => batch.length)).toEqual(
      [100, 1]
    )
    expect(fetchNextmoeWorks.mock.calls[1][0]).toEqual(['vndb:v101'])
    expect(pauseBetweenBatches).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ candidates: [], failures: [], warnings: [] })
  })

  it('reports a batch failure and keeps the other batches', async () => {
    const refs = Array.from({ length: 101 }, (_, index) => String(index + 1))
    const fetchNextmoeWorks = vi
      .fn()
      .mockRejectedValueOnce(new Error('NextMoe unavailable'))
      .mockResolvedValue({ object: 'list', items: [], missing: [] })

    const result = await fetchNextmoeEvidence({
      state: relationState(refs),
      fetchNextmoeWorks,
      fetchNextmoeCompanies: vi.fn(async () => ({
        object: 'list' as const,
        items: [],
        missing: []
      })),
      pauseBetweenBatches: async () => undefined
    })

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('NextMoe unavailable')
    expect(fetchNextmoeWorks).toHaveBeenCalledTimes(2)
  })
})
