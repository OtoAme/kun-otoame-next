import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPANY_CLEANUP_SCHEMA_VERSION,
  COMPANY_CLEANUP_TOOL_VERSION,
  COMPANY_NORMALIZATION_VERSION,
  companyCleanupDecisionsSchema,
  getReceiptPath,
  readProtectedArtifact,
  serializeCanonicalJson,
  writeCanonicalArtifact,
  type CompanyCleanupPlan,
  type CompanyDatabaseState,
  type CompanyState
} from '~/scripts/companyCleanupFrozenContract'
import {
  applyActionsToCompanyDatabaseState,
  digestSemanticCompanyDatabaseState,
  validateActionTopology
} from '~/scripts/companyCleanupFrozenState'
import {
  classifyCompanyCleanupState,
  validateFrozenPlanSimulation
} from '~/scripts/companyCleanupFrozenApply'
import { runFrozenCompanyCleanupCache } from '~/scripts/companyCleanupFrozenCache'
import { parseFrozenCompanyCleanupCliArguments } from '~/scripts/companyCleanupFrozenCli'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const relation = (patchId: number, patchUniqueId: string) => ({
  patchId,
  patchUniqueId,
  vndbId: `v${patchId}`
})

const company = (
  id: number,
  name: string,
  overrides: Partial<CompanyState> = {}
): CompanyState => ({
  id,
  ref: `company-${id}`,
  name,
  normalizedName: name.toLowerCase(),
  introduction: '',
  count: 0,
  primaryLanguage: [],
  sourceWebsites: [],
  parentBrands: [],
  aliases: [],
  ownerRef: `owner-${id}`,
  updated: '2026-08-31T00:00:00.000Z',
  externalIds: [],
  identities: [
    {
      kind: 'name',
      origin: 'authoritative',
      value: name,
      normalizedValue: name.toLowerCase(),
      confirmedByRef: null
    }
  ],
  relations: [],
  ...overrides
})

const preState = (): CompanyDatabaseState => ({
  companies: [
    company(1, 'Canonical', {
      count: 1,
      primaryLanguage: ['ja'],
      sourceWebsites: ['https://canonical.example'],
      externalIds: [{ source: 'vndb', externalId: 'p1' }],
      relations: [relation(1, 'patch-1')]
    }),
    company(2, '旧会社', {
      normalizedName: '旧会社',
      introduction: 'Source introduction',
      count: 2,
      primaryLanguage: ['zh'],
      sourceWebsites: ['https://source.example'],
      parentBrands: ['Parent'],
      aliases: ['Old Studio'],
      externalIds: [{ source: 'steam', externalId: 'steam-2' }],
      identities: [
        {
          kind: 'name',
          origin: 'authoritative',
          value: '旧会社',
          normalizedValue: '旧会社',
          confirmedByRef: 'confirmer-7'
        },
        {
          kind: 'alias',
          origin: 'legacy',
          value: 'Old Studio',
          normalizedValue: 'old studio',
          confirmedByRef: null
        }
      ],
      relations: [relation(1, 'patch-1'), relation(2, 'patch-2')]
    }),
    company(3, 'Explicitly Empty'),
    company(4, 'Unrelated', {
      count: 1,
      relations: [relation(3, 'patch-3')]
    })
  ]
})

const planFor = (
  before: CompanyDatabaseState,
  after: CompanyDatabaseState,
  mergeActions: CompanyCleanupPlan['mergeActions'],
  deleteActions: CompanyCleanupPlan['deleteActions']
): CompanyCleanupPlan => {
  const companyIds = [
    ...new Set([
      ...mergeActions.flatMap((merge) => [
        merge.targetCompanyId,
        ...merge.sourceCompanyIds
      ]),
      ...deleteActions.map((action) => action.companyId)
    ])
  ].sort((left, right) => left - right)
  const patchUniqueIds = [
    ...new Set(
      before.companies
        .filter((company) => companyIds.includes(company.id))
        .flatMap((company) =>
          company.relations.map((relation) => relation.patchUniqueId)
        )
    )
  ].sort((left, right) => left.localeCompare(right, 'en'))
  return {
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    toolVersion: COMPANY_CLEANUP_TOOL_VERSION,
    normalizationVersion: COMPANY_NORMALIZATION_VERSION,
    generatedCommit: 'a'.repeat(40),
    generatedAt: '2026-08-31T00:00:00.000Z',
    inventorySha256: 'b'.repeat(64),
    preDatabaseDigest: 'c'.repeat(64),
    expectedPostDatabaseDigest: digestSemanticCompanyDatabaseState(after),
    preState: before,
    expectedPostState: after,
    evidenceActions: [],
    mergeActions,
    deleteActions,
    blockers: [],
    warnings: [],
    cacheTargets: {
      companyIds,
      patchUniqueIds,
      pagePaths: [
        '/',
        '/otomegame',
        '/company',
        ...companyIds.map((companyId) => `/company/${companyId}`),
        ...patchUniqueIds.map((uniqueId) => `/${uniqueId}`)
      ],
      apiPrefixes: ['/api/home', '/api/company/otomegame']
    },
    limits: {
      actions: mergeActions.length + deleteActions.length,
      relations: before.companies
        .filter((company) => companyIds.includes(company.id))
        .reduce((sum, company) => sum + company.relations.length, 0)
    }
  }
}

describe('frozen company cleanup contract', () => {
  it('canonicalizes object keys and array order into stable bytes', () => {
    expect(serializeCanonicalJson({ z: ['b', 'a'], a: { y: 2, x: 1 } })).toBe(
      serializeCanonicalJson({ a: { x: 1, y: 2 }, z: ['a', 'b'] })
    )
  })

  it('rejects unknown decision fields', () => {
    expect(
      companyCleanupDecisionsSchema.safeParse({
        schemaVersion: 1,
        inventorySha256: 'a'.repeat(64),
        merges: [],
        deletions: [],
        force: true
      }).success
    ).toBe(false)
  })

  it('rejects unknown, duplicate and valueless maintenance CLI arguments', () => {
    expect(() =>
      parseFrozenCompanyCleanupCliArguments('apply', ['--plan=a', '--plan=b'])
    ).toThrow('Duplicate argument')
    expect(() =>
      parseFrozenCompanyCleanupCliArguments('dry', ['--force'])
    ).toThrow('Unknown argument')
    expect(() =>
      parseFrozenCompanyCleanupCliArguments('inventory', ['--out'])
    ).toThrow('Missing value')
  })

  it('writes private artifacts atomically and refuses overwrite or symlinks', async () => {
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), 'kun-company-cleanup-')
    )
    temporaryDirectories.push(directory)
    await chmod(directory, 0o700)
    const artifact = join(directory, 'plan.json')
    await writeCanonicalArtifact(artifact, { ok: true }, { sidecar: true })
    expect((await readFile(artifact, 'utf8')).endsWith('\n')).toBe(true)
    await expect(
      writeCanonicalArtifact(artifact, { ok: false })
    ).rejects.toThrow('overwrite')

    const linked = join(directory, 'linked.json')
    await symlink(artifact, linked)
    await expect(readProtectedArtifact(linked)).rejects.toThrow('symlinks')
  })
})

describe('frozen company cleanup state transition', () => {
  it('preserves external IDs, confirmed identity provenance and reviewed metadata', () => {
    const before = preState()
    const result = applyActionsToCompanyDatabaseState(
      before,
      [],
      [
        {
          kind: 'manual',
          targetCompanyId: 1,
          sourceCompanyIds: [2],
          ownerFromCompanyId: 2,
          introductionFromCompanyId: 2,
          reason: 'reviewed duplicate'
        }
      ],
      [{ companyId: 3, reason: 'explicit reviewed deletion' }]
    )

    const target = result.state.companies.find((row) => row.id === 1)!
    expect(target.ownerRef).toBe('owner-2')
    expect(target.introduction).toBe('Source introduction')
    expect(target.externalIds).toEqual(
      expect.arrayContaining([
        { source: 'vndb', externalId: 'p1' },
        { source: 'steam', externalId: 'steam-2' }
      ])
    )
    expect(target.identities).toContainEqual({
      kind: 'alias',
      origin: 'authoritative',
      value: '旧会社',
      normalizedValue: '旧会社',
      confirmedByRef: 'confirmer-7'
    })
    expect(target.relations.map((item) => item.patchId).sort()).toEqual([1, 2])
    expect(target.count).toBe(2)
    expect(result.state.companies.map((row) => row.id)).toEqual([1, 4])
    expect(result.state.companies.find((row) => row.id === 4)).toEqual(
      before.companies.find((row) => row.id === 4)
    )

    const plan = planFor(before, result.state, result.mergeActions, [
      { companyId: 3, reason: 'explicit reviewed deletion' }
    ])
    expect(() => validateFrozenPlanSimulation(plan)).not.toThrow()
    const misleading = structuredClone(plan)
    misleading.mergeActions[0].expectedTarget = {
      ...misleading.mergeActions[0].expectedTarget,
      introduction: 'not the executable post-state'
    }
    expect(() => validateFrozenPlanSimulation(misleading)).toThrow(
      'expectedTarget snapshots'
    )
  })

  it('rejects overlapping/cyclic actions and never infers empty deletion', () => {
    expect(() =>
      validateActionTopology(
        [
          { targetCompanyId: 1, sourceCompanyIds: [2] },
          { targetCompanyId: 2, sourceCompanyIds: [3] }
        ],
        []
      )
    ).toThrow('both a merge source and target')

    const before = preState()
    const result = applyActionsToCompanyDatabaseState(before, [], [], [])
    expect(result.state.companies.some((row) => row.id === 3)).toBe(true)
  })

  it('classifies exact post-state replay separately from drift', () => {
    const before = preState()
    const simulated = applyActionsToCompanyDatabaseState(before, [], [], [])
    const plan = planFor(before, simulated.state, [], [])
    plan.preDatabaseDigest = '0'.repeat(64)
    expect(classifyCompanyCleanupState(simulated.state, plan)).toBe(
      'already-applied'
    )
    const drifted = structuredClone(simulated.state)
    drifted.companies[0].introduction = 'unexpected'
    expect(classifyCompanyCleanupState(drifted, plan)).toBe('drift')
  })
})

describe('frozen company cleanup cache retry', () => {
  it('records an unconfirmed Cloudflare purge and succeeds on cache-only retry', async () => {
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), 'kun-company-cache-')
    )
    temporaryDirectories.push(directory)
    await chmod(directory, 0o700)
    const planPath = join(directory, 'plan.json')
    const before = preState()
    const plan = planFor(before, before, [], [])
    const planSha256 = 'd'.repeat(64)
    await writeCanonicalArtifact(getReceiptPath(planPath), {
      schemaVersion: 1,
      toolVersion: COMPANY_CLEANUP_TOOL_VERSION,
      planSha256,
      expectedPostDatabaseDigest: plan.expectedPostDatabaseDigest,
      databaseStatus: 'applied',
      committedAt: '2026-08-31T00:00:00.000Z',
      cache: {
        status: 'pending',
        attemptedAt: null,
        redis: 'pending',
        cloudflare: 'pending',
        isr: 'deferred-to-deploy',
        detail: null
      }
    })

    const invalidateRedis = vi.fn(async () => undefined)
    const dependencies = {
      loadState: async () => before,
      invalidateRedis,
      purgeCloudflare: async () => [{ status: 200, success: false }]
    }
    await expect(
      runFrozenCompanyCleanupCache({
        db: {} as never,
        plan,
        planPath,
        planSha256,
        dependencies
      })
    ).rejects.toThrow('not confirmed')
    expect(
      JSON.parse(await readProtectedArtifact(getReceiptPath(planPath))).cache
        .status
    ).toBe('failed')

    const receipt = await runFrozenCompanyCleanupCache({
      db: {} as never,
      plan,
      planPath,
      planSha256,
      dependencies: {
        ...dependencies,
        purgeCloudflare: async () => [{ status: 200, success: true }]
      }
    })
    expect(receipt.cache.status).toBe('complete')
    expect(invalidateRedis).toHaveBeenCalledTimes(1)
  })
})
