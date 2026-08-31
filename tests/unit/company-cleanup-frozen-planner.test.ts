import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  COMPANY_CLEANUP_SCHEMA_VERSION,
  writeCanonicalArtifact,
  type CompanyDatabaseState
} from '~/scripts/companyCleanupFrozenContract'
import {
  buildCompanyInventory,
  generateFrozenCompanyCleanupPlan
} from '~/scripts/companyCleanupFrozenPlanner'
import {
  getCompanyOwnerRef,
  getCompanyRef
} from '~/scripts/companyCleanupFrozenState'

const temporaryDirectories: string[] = []

afterEach(async () => {
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
        ? [{ patchId: 10, patchUniqueId: 'patch-10', vndbId: 'v10' }]
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
    relations: [{ patchId: 11, patchUniqueId: 'patch-11', vndbId: 'v11' }]
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
        vndb_id: relation.vndbId
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

    const result = await generateFrozenCompanyCleanupPlan({
      db: database([snapshot, snapshot]) as never,
      ...paths,
      manualOnly: true,
      fetchVndbCandidates
    })

    expect(fetchVndbCandidates).not.toHaveBeenCalled()
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
  })
})
