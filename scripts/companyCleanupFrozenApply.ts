import { Prisma, type PrismaClient } from '@prisma/client'
import {
  COMPANY_CLEANUP_SCHEMA_VERSION,
  COMPANY_CLEANUP_TOOL_VERSION,
  companyCleanupReceiptSchema,
  digestCompanyDatabaseState,
  getReceiptPath,
  readPlanWithVerifiedSidecar,
  readProtectedArtifact,
  serializeCanonicalJson,
  writeCanonicalArtifact,
  type CompanyCleanupPlan,
  type CompanyCleanupReceipt,
  type CompanyDatabaseState
} from './companyCleanupFrozenContract'
import {
  applyActionsToCompanyDatabaseState,
  digestSemanticCompanyDatabaseState,
  getCompanyConfirmerRef,
  getCompanyOwnerRef,
  loadCompanyDatabaseState
} from './companyCleanupFrozenState'

type ApplyStatus = 'ready' | 'already-applied' | 'drift'

const COMPANY_COUNTER_FUNCTION_SOURCES = {
  patch_company_count_trg_ins: `
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT company_id AS parent_id, COUNT(*)::integer AS delta
    FROM new_rows
    GROUP BY company_id
    ORDER BY company_id
  LOOP
    UPDATE public.patch_company
    SET count = count + counter.delta
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END`,
  patch_company_count_trg_del: `
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT company_id AS parent_id, COUNT(*)::integer AS delta
    FROM old_rows
    GROUP BY company_id
    ORDER BY company_id
  LOOP
    UPDATE public.patch_company
    SET count = GREATEST(count - counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END`,
  patch_company_count_trg_upd: `
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT parent_id, SUM(delta)::integer AS delta
    FROM (
      SELECT old_row.company_id AS parent_id, -1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
      UNION ALL
      SELECT new_row.company_id AS parent_id, 1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
    ) changes
    GROUP BY parent_id
    ORDER BY parent_id
  LOOP
    UPDATE public.patch_company
    SET count = GREATEST(count + counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END`
} as const

const normalizeSqlSource = (value: string) => value.replace(/\s+/g, '')

const sortedUniqueNumbers = (values: number[]) =>
  [...new Set(values)].sort((left, right) => left - right)

const sortedUniqueStrings = (values: string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))

const sameCanonical = (left: unknown, right: unknown) =>
  serializeCanonicalJson(left) === serializeCanonicalJson(right)

export const validateFrozenPlanDerivedFields = (plan: CompanyCleanupPlan) => {
  const companyIds = sortedUniqueNumbers([
    ...plan.evidenceActions.map((action) => action.companyId),
    ...plan.mergeActions.flatMap((merge) => [
      merge.targetCompanyId,
      ...merge.sourceCompanyIds
    ]),
    ...plan.deleteActions.map((action) => action.companyId)
  ])
  const patchUniqueIds = sortedUniqueStrings(
    plan.preState.companies
      .filter((company) => companyIds.includes(company.id))
      .flatMap((company) =>
        company.relations.map((relation) => relation.patchUniqueId)
      )
  )
  const pagePaths = sortedUniqueStrings([
    '/',
    '/otomegame',
    '/company',
    ...companyIds.map((companyId) => `/company/${companyId}`),
    ...patchUniqueIds.map((uniqueId) => `/${uniqueId}`)
  ])
  const expectedCacheTargets = {
    companyIds,
    patchUniqueIds,
    pagePaths,
    apiPrefixes: ['/api/home', '/api/company/otomegame']
  }
  if (!sameCanonical(plan.cacheTargets, expectedCacheTargets)) {
    throw new Error(
      'Frozen plan cache/affected targets do not match its actions'
    )
  }
  const expectedLimits = {
    actions:
      plan.evidenceActions.length +
      plan.mergeActions.length +
      plan.deleteActions.length,
    relations: plan.preState.companies
      .filter((company) => companyIds.includes(company.id))
      .reduce((sum, company) => sum + company.relations.length, 0)
  }
  if (!sameCanonical(plan.limits, expectedLimits)) {
    throw new Error('Frozen plan limits do not match its actions')
  }
}

export const classifyCompanyCleanupState = (
  current: CompanyDatabaseState,
  plan: CompanyCleanupPlan
): ApplyStatus => {
  if (
    digestSemanticCompanyDatabaseState(current) ===
    plan.expectedPostDatabaseDigest
  ) {
    return 'already-applied'
  }
  if (digestCompanyDatabaseState(current) === plan.preDatabaseDigest) {
    return 'ready'
  }
  return 'drift'
}

export const validateFrozenPlanSimulation = (plan: CompanyCleanupPlan) => {
  validateFrozenPlanDerivedFields(plan)
  const simulated = applyActionsToCompanyDatabaseState(
    plan.preState,
    plan.evidenceActions,
    plan.mergeActions.map((merge) => ({
      kind: merge.kind,
      targetCompanyId: merge.targetCompanyId,
      sourceCompanyIds: merge.sourceCompanyIds,
      ownerFromCompanyId: merge.ownerFromCompanyId,
      introductionFromCompanyId: merge.introductionFromCompanyId,
      reason: merge.reason
    })),
    plan.deleteActions
  )
  if (
    digestSemanticCompanyDatabaseState(simulated.state) !==
    plan.expectedPostDatabaseDigest
  ) {
    throw new Error('Frozen plan post-state digest does not match its actions')
  }
  if (
    serializeCanonicalJson(simulated.state) !==
    serializeCanonicalJson(plan.expectedPostState)
  ) {
    throw new Error(
      'Frozen plan expected post-state does not match its actions'
    )
  }
  if (
    serializeCanonicalJson(simulated.mergeActions) !==
    serializeCanonicalJson(plan.mergeActions)
  ) {
    throw new Error(
      'Frozen plan merge expectedTarget snapshots do not match their actions'
    )
  }
}

const assertCounterContract = async (tx: Prisma.TransactionClient) => {
  const triggers = await tx.$queryRaw<
    Array<{
      trigger_name: string
      enabled: string
      old_table: string | null
      new_table: string | null
      is_statement: boolean
      trigger_type: number
      function_name: string
      function_source: string
      function_is_trigger: boolean
      function_argument_count: number
      function_kind: string
    }>
  >(Prisma.sql`
    SELECT
      trigger_row.tgname AS trigger_name,
      trigger_row.tgenabled::text AS enabled,
      trigger_row.tgoldtable AS old_table,
      trigger_row.tgnewtable AS new_table,
      ((trigger_row.tgtype & 1) = 0) AS is_statement,
      trigger_row.tgtype::integer AS trigger_type,
      procedure_row.proname AS function_name,
      procedure_row.prosrc AS function_source,
      (procedure_row.prorettype = 'pg_catalog.trigger'::regtype) AS function_is_trigger,
      procedure_row.pronargs::integer AS function_argument_count,
      procedure_row.prokind::text AS function_kind
    FROM pg_trigger trigger_row
    JOIN pg_proc procedure_row ON procedure_row.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'public.patch_company_relation'::regclass
      AND trigger_row.tgname IN (
        'patch_company_count_trg_ins',
        'patch_company_count_trg_del',
        'patch_company_count_trg_upd'
      )
      AND NOT trigger_row.tgisinternal
    ORDER BY trigger_row.tgname
  `)
  const byName = new Map(
    triggers.map((trigger) => [trigger.trigger_name, trigger])
  )
  const expected = [
    ['patch_company_count_trg_ins', null, 'new_rows', 4],
    ['patch_company_count_trg_del', 'old_rows', null, 8],
    ['patch_company_count_trg_upd', 'old_rows', 'new_rows', 16]
  ] as const
  for (const [name, oldTable, newTable, triggerType] of expected) {
    const trigger = byName.get(name)
    if (
      !trigger ||
      trigger.enabled !== 'O' ||
      !trigger.is_statement ||
      trigger.trigger_type !== triggerType ||
      trigger.function_name !== name ||
      !trigger.function_is_trigger ||
      trigger.function_argument_count !== 0 ||
      trigger.function_kind !== 'f' ||
      normalizeSqlSource(trigger.function_source) !==
        normalizeSqlSource(COMPANY_COUNTER_FUNCTION_SOURCES[name]) ||
      trigger.old_table !== oldTable ||
      trigger.new_table !== newTable
    ) {
      throw new Error(
        `Company relation count trigger contract mismatch: ${name}`
      )
    }
  }

  const mismatch = await tx.$queryRaw<Array<{ mismatch_count: number }>>(
    Prisma.sql`
      SELECT COUNT(*)::integer AS mismatch_count
      FROM (
        SELECT company.id
        FROM public.patch_company company
        LEFT JOIN public.patch_company_relation relation
          ON relation.company_id = company.id
        GROUP BY company.id, company.count
        HAVING company.count IS DISTINCT FROM COUNT(relation.id)::integer
      ) mismatches
    `
  )
  if ((mismatch[0]?.mismatch_count ?? -1) !== 0) {
    throw new Error(
      'patch_company.count is not equal to its real relation count'
    )
  }
}

const setTransactionTimeouts = async (
  tx: Prisma.TransactionClient,
  lockTimeoutMs: number,
  statementTimeoutMs: number
) => {
  if (
    !Number.isInteger(lockTimeoutMs) ||
    lockTimeoutMs < 100 ||
    lockTimeoutMs > 60000 ||
    !Number.isInteger(statementTimeoutMs) ||
    statementTimeoutMs < 1000 ||
    statementTimeoutMs > 300000
  ) {
    throw new Error('Invalid company cleanup transaction timeout')
  }
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`)
  await tx.$executeRawUnsafe(
    `SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`
  )
}

const lockCompanyMaintenanceTables = async (tx: Prisma.TransactionClient) => {
  await tx.$executeRawUnsafe(
    'LOCK TABLE public.patch_company_relation IN SHARE ROW EXCLUSIVE MODE'
  )
  await tx.$executeRawUnsafe(
    'LOCK TABLE public.patch_company IN SHARE ROW EXCLUSIVE MODE'
  )
  await tx.$executeRawUnsafe(
    'LOCK TABLE public.patch_company_external_id IN SHARE ROW EXCLUSIVE MODE'
  )
  await tx.$executeRawUnsafe(
    'LOCK TABLE public.patch_company_name_identity IN SHARE ROW EXCLUSIVE MODE'
  )
}

const replaceAffectedCompanyState = async (
  tx: Prisma.TransactionClient,
  plan: CompanyCleanupPlan
) => {
  const affectedCompanyIds = new Set(plan.cacheTargets.companyIds)
  if (!affectedCompanyIds.size) return

  const actualCompanies = await tx.patch_company.findMany({
    where: { id: { in: [...affectedCompanyIds] } },
    select: { id: true, user_id: true }
  })
  const actualIdentities = await tx.patch_company_name_identity.findMany({
    where: {
      company_id: { in: [...affectedCompanyIds] },
      confirmed_by_user_id: { not: null }
    },
    select: { confirmed_by_user_id: true }
  })
  const ownerIdByRef = new Map(
    actualCompanies.map((company) => [
      getCompanyOwnerRef(company.user_id),
      company.user_id
    ])
  )
  const confirmerIdByRef = new Map(
    actualIdentities
      .filter(
        (identity): identity is { confirmed_by_user_id: number } =>
          identity.confirmed_by_user_id !== null
      )
      .map((identity) => [
        getCompanyConfirmerRef(identity.confirmed_by_user_id),
        identity.confirmed_by_user_id
      ])
  )

  const expectedCompanies = plan.expectedPostState.companies.filter((company) =>
    affectedCompanyIds.has(company.id)
  )
  const expectedIds = new Set(expectedCompanies.map((company) => company.id))
  const removedCompanyIds = [...affectedCompanyIds].filter(
    (companyId) => !expectedIds.has(companyId)
  )

  await tx.patch_company_relation.deleteMany({
    where: { company_id: { in: [...affectedCompanyIds] } }
  })
  await tx.patch_company_external_id.deleteMany({
    where: { company_id: { in: [...affectedCompanyIds] } }
  })
  await tx.patch_company_name_identity.deleteMany({
    where: { company_id: { in: [...affectedCompanyIds] } }
  })
  if (removedCompanyIds.length) {
    const deleted = await tx.patch_company.deleteMany({
      where: { id: { in: removedCompanyIds }, patch_relations: { none: {} } }
    })
    if (deleted.count !== removedCompanyIds.length) {
      throw new Error('Not every explicitly removed company was deleted')
    }
  }

  for (const company of expectedCompanies) {
    const ownerId = ownerIdByRef.get(company.ownerRef)
    if (!ownerId)
      throw new Error(`Cannot resolve owner for company #${company.id}`)
    await tx.patch_company.update({
      where: { id: company.id },
      data: {
        name: company.name,
        normalized_name: company.normalizedName!,
        introduction: company.introduction,
        primary_language: company.primaryLanguage,
        official_website: company.sourceWebsites,
        parent_brand: company.parentBrands,
        alias: company.aliases,
        user_id: ownerId
      }
    })
  }

  const externalRows = expectedCompanies.flatMap((company) =>
    company.externalIds.map((external) => ({
      company_id: company.id,
      source: external.source,
      external_id: external.externalId
    }))
  )
  if (externalRows.length) {
    await tx.patch_company_external_id.createMany({ data: externalRows })
  }

  const identityRows = expectedCompanies.flatMap((company) =>
    company.identities.map((identity) => {
      const confirmedByUserId = identity.confirmedByRef
        ? confirmerIdByRef.get(identity.confirmedByRef)
        : null
      if (identity.confirmedByRef && !confirmedByUserId) {
        throw new Error(
          `Cannot resolve confirmed identity provenance for company #${company.id}`
        )
      }
      return {
        company_id: company.id,
        kind: identity.kind,
        origin: identity.origin,
        value: identity.value,
        normalized_value: identity.normalizedValue,
        confirmed_by_user_id: confirmedByUserId
      }
    })
  )
  if (identityRows.length) {
    await tx.patch_company_name_identity.createMany({ data: identityRows })
  }

  const relationRows = expectedCompanies.flatMap((company) =>
    company.relations.map((relation) => ({
      company_id: company.id,
      patch_id: relation.patchId
    }))
  )
  if (relationRows.length) {
    await tx.patch_company_relation.createMany({ data: relationRows })
  }
}

const buildPendingReceipt = (
  plan: CompanyCleanupPlan,
  planSha256: string,
  databaseStatus: 'applied' | 'already-applied',
  now = new Date()
): CompanyCleanupReceipt =>
  companyCleanupReceiptSchema.parse({
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    toolVersion: COMPANY_CLEANUP_TOOL_VERSION,
    planSha256,
    expectedPostDatabaseDigest: plan.expectedPostDatabaseDigest,
    databaseStatus,
    committedAt: now.toISOString(),
    cache: {
      status: 'pending',
      attemptedAt: null,
      redis: 'pending',
      cloudflare: 'pending',
      isr: 'deferred-to-deploy',
      detail: null
    }
  })

export const dryRunFrozenCompanyCleanup = async (
  db: PrismaClient,
  plan: CompanyCleanupPlan
) => {
  if (plan.blockers.length) {
    throw new Error(`Frozen plan has blockers:\n${plan.blockers.join('\n')}`)
  }
  validateFrozenPlanSimulation(plan)
  const state = await loadCompanyDatabaseState(db)
  const status = classifyCompanyCleanupState(state, plan)
  if (status === 'drift') {
    throw new Error(
      'Frozen company cleanup plan no longer matches the database'
    )
  }
  return {
    status,
    actions: status === 'ready' ? plan.limits.actions : 0,
    relations: status === 'ready' ? plan.limits.relations : 0,
    warnings: plan.warnings
  }
}

export const applyFrozenCompanyCleanup = async (input: {
  db: PrismaClient
  plan: CompanyCleanupPlan
  planSha256: string
  planPath: string
  confirmSha256: string
  lockTimeoutMs?: number
  statementTimeoutMs?: number
}) => {
  if (input.confirmSha256 !== input.planSha256) {
    throw new Error('The confirmed SHA-256 does not match the frozen plan')
  }
  if (input.plan.blockers.length) {
    throw new Error(
      `Frozen plan has blockers:\n${input.plan.blockers.join('\n')}`
    )
  }
  validateFrozenPlanSimulation(input.plan)

  const result = await input.db.$transaction(
    async (tx) => {
      await setTransactionTimeouts(
        tx,
        input.lockTimeoutMs ?? 10000,
        input.statementTimeoutMs ?? 120000
      )
      await lockCompanyMaintenanceTables(tx)
      await assertCounterContract(tx)

      const current = await loadCompanyDatabaseState(tx)
      const status = classifyCompanyCleanupState(current, input.plan)
      if (status === 'drift') {
        throw new Error(
          'Frozen company cleanup plan drifted; no database writes were made'
        )
      }
      if (status === 'already-applied') {
        return { databaseStatus: 'already-applied' as const }
      }

      await replaceAffectedCompanyState(tx, input.plan)
      await assertCounterContract(tx)
      const postState = await loadCompanyDatabaseState(tx)
      if (
        digestSemanticCompanyDatabaseState(postState) !==
        input.plan.expectedPostDatabaseDigest
      ) {
        throw new Error('Company cleanup post-state verification failed')
      }
      return { databaseStatus: 'applied' as const }
    },
    {
      timeout: Math.min((input.statementTimeoutMs ?? 120000) + 10000, 310000)
    }
  )

  if (result.databaseStatus === 'already-applied') {
    try {
      return await readVerifiedCompanyCleanupReceipt(
        input.planPath,
        input.planSha256,
        input.plan.expectedPostDatabaseDigest
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  const receipt = buildPendingReceipt(
    input.plan,
    input.planSha256,
    result.databaseStatus
  )
  await writeCanonicalArtifact(getReceiptPath(input.planPath), receipt, {
    replace: true
  })
  return receipt
}

export const readVerifiedCompanyCleanupReceipt = async (
  planPath: string,
  planSha256: string,
  expectedPostDatabaseDigest?: string
) => {
  const rawReceipt = await readProtectedArtifact(getReceiptPath(planPath))
  const receipt = companyCleanupReceiptSchema.parse(JSON.parse(rawReceipt))
  if (serializeCanonicalJson(receipt) !== rawReceipt) {
    throw new Error('Company cleanup receipt is not canonical JSON')
  }
  if (receipt.planSha256 !== planSha256) {
    throw new Error('Company cleanup receipt belongs to a different plan')
  }
  if (
    expectedPostDatabaseDigest &&
    receipt.expectedPostDatabaseDigest !== expectedPostDatabaseDigest
  ) {
    throw new Error('Company cleanup receipt post-state digest mismatch')
  }
  return receipt
}

export const loadFrozenCompanyCleanupPlan = readPlanWithVerifiedSidecar
