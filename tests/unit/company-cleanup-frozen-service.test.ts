import {
  access,
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPANY_CLEANUP_SCHEMA_VERSION,
  COMPANY_CLEANUP_TOOL_VERSION,
  COMPANY_NORMALIZATION_VERSION,
  digestCompanyDatabaseState,
  getReceiptPath,
  writeCanonicalArtifact,
  type CompanyCleanupPlan,
  type CompanyDatabaseState
} from '~/scripts/companyCleanupFrozenContract'
import {
  applyActionsToCompanyDatabaseState,
  digestSemanticCompanyDatabaseState,
  getCompanyRef,
  getCompanyOwnerRef
} from '~/scripts/companyCleanupFrozenState'
import {
  applyFrozenCompanyCleanup,
  dryRunFrozenCompanyCleanup
} from '~/scripts/companyCleanupFrozenApply'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const beforeState = (): CompanyDatabaseState => ({
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
          value: 'Palette',
          normalizedValue: 'palette',
          confirmedByRef: null
        }
      ],
      relations: [{ patchId: 10, patchUniqueId: 'patch-10', vndbId: 'v10' }]
    }
  ]
})

const toRows = (state: CompanyDatabaseState) =>
  state.companies.map((company) => ({
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
    external_ids: company.externalIds.map((external) => ({
      source: external.source,
      external_id: external.externalId
    })),
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

const buildPlan = () => {
  const before = beforeState()
  const evidenceActions: CompanyCleanupPlan['evidenceActions'] = [
    {
      companyId: 1,
      source: 'vndb',
      externalId: 'p1',
      authoritativeValues: ['Palette', 'ぱれっと']
    }
  ]
  const after = applyActionsToCompanyDatabaseState(
    before,
    evidenceActions,
    [],
    []
  ).state
  const plan: CompanyCleanupPlan = {
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    toolVersion: COMPANY_CLEANUP_TOOL_VERSION,
    normalizationVersion: COMPANY_NORMALIZATION_VERSION,
    generatedCommit: 'a'.repeat(40),
    generatedAt: '2026-08-31T00:00:00.000Z',
    inventorySha256: 'b'.repeat(64),
    preDatabaseDigest: digestCompanyDatabaseState(before),
    expectedPostDatabaseDigest: digestSemanticCompanyDatabaseState(after),
    preState: before,
    expectedPostState: after,
    evidenceActions,
    mergeActions: [],
    deleteActions: [],
    blockers: [],
    warnings: [],
    cacheTargets: {
      companyIds: [1],
      patchUniqueIds: ['patch-10'],
      pagePaths: ['/', '/otomegame', '/company', '/company/1', '/patch-10'],
      apiPrefixes: ['/api/home', '/api/company/otomegame']
    },
    limits: { actions: 1, relations: 1 }
  }
  return { before, after, plan }
}

const triggers = [
  {
    trigger_name: 'patch_company_count_trg_ins',
    enabled: 'O',
    old_table: null,
    new_table: 'new_rows',
    is_statement: true,
    trigger_type: 4,
    function_name: 'patch_company_count_trg_ins',
    function_source: `
DECLARE counter record;
BEGIN
  FOR counter IN SELECT company_id AS parent_id, COUNT(*)::integer AS delta FROM new_rows GROUP BY company_id ORDER BY company_id
  LOOP UPDATE public.patch_company SET count = count + counter.delta WHERE id = counter.parent_id; END LOOP;
  RETURN NULL;
END`,
    function_is_trigger: true,
    function_argument_count: 0,
    function_kind: 'f'
  },
  {
    trigger_name: 'patch_company_count_trg_del',
    enabled: 'O',
    old_table: 'old_rows',
    new_table: null,
    is_statement: true,
    trigger_type: 8,
    function_name: 'patch_company_count_trg_del',
    function_source: `
DECLARE counter record;
BEGIN
  FOR counter IN SELECT company_id AS parent_id, COUNT(*)::integer AS delta FROM old_rows GROUP BY company_id ORDER BY company_id
  LOOP UPDATE public.patch_company SET count = GREATEST(count - counter.delta, 0) WHERE id = counter.parent_id; END LOOP;
  RETURN NULL;
END`,
    function_is_trigger: true,
    function_argument_count: 0,
    function_kind: 'f'
  },
  {
    trigger_name: 'patch_company_count_trg_upd',
    enabled: 'O',
    old_table: 'old_rows',
    new_table: 'new_rows',
    is_statement: true,
    trigger_type: 16,
    function_name: 'patch_company_count_trg_upd',
    function_source: `
DECLARE counter record;
BEGIN
  FOR counter IN
    SELECT parent_id, SUM(delta)::integer AS delta
    FROM (
      SELECT old_row.company_id AS parent_id, -1 AS delta FROM old_rows old_row JOIN new_rows new_row USING (id) WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
      UNION ALL
      SELECT new_row.company_id AS parent_id, 1 AS delta FROM old_rows old_row JOIN new_rows new_row USING (id) WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
    ) changes GROUP BY parent_id ORDER BY parent_id
  LOOP UPDATE public.patch_company SET count = GREATEST(count + counter.delta, 0) WHERE id = counter.parent_id; END LOOP;
  RETURN NULL;
END`,
    function_is_trigger: true,
    function_argument_count: 0,
    function_kind: 'f'
  }
]

const makeTx = (fullStates: CompanyDatabaseState[], triggerRows = triggers) => {
  let fullStateIndex = 0
  let queryIndex = 0
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockImplementation(() => {
      const result =
        queryIndex % 2 === 0 ? triggerRows : [{ mismatch_count: 0 }]
      queryIndex += 1
      return Promise.resolve(result)
    }),
    patch_company: {
      findMany: vi.fn().mockImplementation((args) => {
        if (args?.where) return Promise.resolve([{ id: 1, user_id: 42 }])
        const state =
          fullStates[Math.min(fullStateIndex, fullStates.length - 1)]
        fullStateIndex += 1
        return Promise.resolve(toRows(state))
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({})
    },
    patch_company_relation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    patch_company_external_id: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    patch_company_name_identity: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 })
    }
  }
  return tx
}

describe('frozen company cleanup apply service', () => {
  it('reports zero pending writes once the complete post-state exists', async () => {
    const { after, plan } = buildPlan()
    const db = {
      patch_company: { findMany: vi.fn().mockResolvedValue(toRows(after)) }
    }

    await expect(
      dryRunFrozenCompanyCleanup(db as never, plan)
    ).resolves.toMatchObject({
      status: 'already-applied',
      actions: 0,
      relations: 0
    })
  })

  it('detects drift after locking and performs zero mutations', async () => {
    const { before, plan } = buildPlan()
    const drifted = structuredClone(before)
    drifted.companies[0].introduction = 'changed after review'
    const tx = makeTx([drifted])
    const db = {
      $transaction: vi.fn((callback) => callback(tx))
    }

    await expect(
      applyFrozenCompanyCleanup({
        db: db as never,
        plan,
        planSha256: 'c'.repeat(64),
        planPath: '/unused/plan.json',
        confirmSha256: 'c'.repeat(64)
      })
    ).rejects.toThrow('no database writes')
    expect(tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
    expect(tx.patch_company_external_id.deleteMany).not.toHaveBeenCalled()
    expect(tx.patch_company_name_identity.deleteMany).not.toHaveBeenCalled()
    expect(tx.$executeRawUnsafe.mock.calls.map(([sql]) => sql)).toEqual([
      "SET LOCAL lock_timeout = '10000ms'",
      "SET LOCAL statement_timeout = '120000ms'",
      'LOCK TABLE public.patch_company_relation IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.patch_company IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.patch_company_external_id IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.patch_company_name_identity IN SHARE ROW EXCLUSIVE MODE'
    ])
  })

  it('rejects an incomplete trigger contract before reading or mutating company rows', async () => {
    const { before, plan } = buildPlan()
    const invalidTriggers = structuredClone(triggers)
    invalidTriggers[0].new_table = null
    const tx = makeTx([before], invalidTriggers)
    const db = { $transaction: vi.fn((callback) => callback(tx)) }

    await expect(
      applyFrozenCompanyCleanup({
        db: db as never,
        plan,
        planSha256: 'c'.repeat(64),
        planPath: '/unused/plan.json',
        confirmSha256: 'c'.repeat(64)
      })
    ).rejects.toThrow('trigger contract mismatch')
    expect(tx.patch_company.findMany).not.toHaveBeenCalled()
    expect(tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
  })

  it('rebuilds a pending receipt from the complete post-state without database writes', async () => {
    const { after, plan } = buildPlan()
    const tx = makeTx([after])
    const db = { $transaction: vi.fn((callback) => callback(tx)) }
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), 'kun-company-replay-')
    )
    temporaryDirectories.push(directory)
    await chmod(directory, 0o700)
    const planPath = join(directory, 'plan.json')

    const receipt = await applyFrozenCompanyCleanup({
      db: db as never,
      plan,
      planSha256: 'c'.repeat(64),
      planPath,
      confirmSha256: 'c'.repeat(64)
    })

    expect(receipt.databaseStatus).toBe('already-applied')
    expect(tx.patch_company_relation.deleteMany).not.toHaveBeenCalled()
    expect(
      JSON.parse(await readFile(getReceiptPath(planPath), 'utf8'))
        .databaseStatus
    ).toBe('already-applied')

    await writeCanonicalArtifact(
      getReceiptPath(planPath),
      {
        ...receipt,
        cache: {
          status: 'complete',
          attemptedAt: '2026-08-31T01:00:00.000Z',
          redis: 'complete',
          cloudflare: 'complete',
          isr: 'deferred-to-deploy',
          detail: null
        }
      },
      { replace: true }
    )
    const replay = await applyFrozenCompanyCleanup({
      db: db as never,
      plan,
      planSha256: 'c'.repeat(64),
      planPath,
      confirmSha256: 'c'.repeat(64)
    })
    expect(replay.cache.status).toBe('complete')
  })

  it('keeps the receipt absent when a late write fails inside the one transaction', async () => {
    const { before, after, plan } = buildPlan()
    const tx = makeTx([before, after])
    tx.patch_company_name_identity.createMany.mockRejectedValueOnce(
      new Error('late identity write failed')
    )
    const db = {
      $transaction: vi.fn((callback) => callback(tx))
    }
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), 'kun-company-apply-')
    )
    temporaryDirectories.push(directory)
    await chmod(directory, 0o700)
    const planPath = join(directory, 'plan.json')

    await expect(
      applyFrozenCompanyCleanup({
        db: db as never,
        plan,
        planSha256: 'c'.repeat(64),
        planPath,
        confirmSha256: 'c'.repeat(64)
      })
    ).rejects.toThrow('late identity write failed')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.patch_company_relation.deleteMany).toHaveBeenCalled()
    await expect(access(getReceiptPath(planPath))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('reports the exact company fields that differ after replacement', async () => {
    const { before, after, plan } = buildPlan()
    const unexpectedPostState = structuredClone(after)
    unexpectedPostState.companies[0].count = 2
    unexpectedPostState.companies[0].aliases = ['unexpected alias']
    const tx = makeTx([before, unexpectedPostState])
    const db = { $transaction: vi.fn((callback) => callback(tx)) }

    await expect(
      applyFrozenCompanyCleanup({
        db: db as never,
        plan,
        planSha256: 'c'.repeat(64),
        planPath: '/unused/plan.json',
        confirmSha256: 'c'.repeat(64)
      })
    ).rejects.toThrow(
      'Company cleanup post-state verification failed: company #1 fields: aliases, count'
    )
  })
})
