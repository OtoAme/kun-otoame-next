import type { PrismaClient } from '@prisma/client'
import type { TrustedCompanyCandidate } from '~/app/api/company/identity/types'
import { fetchVerifiedVndbCompanyCandidates } from '~/app/api/edit/vndbCompanyCandidates'
import {
  buildAuthoritativeAliasCompanyMergePlan,
  buildCompanyIdentityInventory,
  planAuthoritativeVndbCompanyEvidence,
  type MaintenanceCompany
} from './companyIdentityMaintenance'
import {
  COMPANY_CLEANUP_MAX_ACTIONS,
  COMPANY_CLEANUP_MAX_RELATIONS,
  COMPANY_CLEANUP_SCHEMA_VERSION,
  COMPANY_CLEANUP_TOOL_VERSION,
  COMPANY_NORMALIZATION_VERSION,
  companyCleanupDecisionsSchema,
  companyCleanupPlanSchema,
  companyInventorySchema,
  digestCompanyDatabaseState,
  getCurrentGitCommit,
  readArtifactWithVerifiedSidecar,
  readProtectedArtifact,
  serializeCanonicalJson,
  sha256Bytes,
  writeCanonicalArtifact,
  type CompanyCleanupPlan,
  type CompanyDatabaseState,
  type CompanyInventory,
  type CompanyState
} from './companyCleanupFrozenContract'
import {
  applyActionsToCompanyDatabaseState,
  digestSemanticCompanyDatabaseState,
  loadCompanyDatabaseState,
  resolveDecisionCompanyIds,
  validateActionTopology
} from './companyCleanupFrozenState'

const VNDB_FETCH_CONCURRENCY = 2

const unique = <T>(values: T[]) => [...new Set(values)]

const toMaintenanceCompany = (company: CompanyState): MaintenanceCompany => ({
  id: company.id,
  name: company.name,
  normalizedName: company.normalizedName,
  alias: company.aliases,
  identities: company.identities.map((identity) => ({
    kind: identity.kind,
    origin: identity.origin,
    value: identity.value,
    normalizedValue: identity.normalizedValue
  })),
  externalIds: company.externalIds
})

const buildInventoryCollisions = (state: CompanyDatabaseState) => {
  const inventory = buildCompanyIdentityInventory(
    state.companies.map(toMaintenanceCompany)
  )
  return [
    ...inventory.missingNormalizedNames.map((company) => ({
      kind: 'missing-normalized-name' as const,
      value: company.name,
      companyRefs: [state.companies.find((row) => row.id === company.id)!.ref],
      blocking: true
    })),
    ...inventory.normalizedNameCollisions.map((collision) => ({
      kind: 'normalized-name' as const,
      value: collision.value,
      companyRefs: collision.companies.map(
        (company) => state.companies.find((row) => row.id === company.id)!.ref
      ),
      blocking: true
    })),
    ...inventory.aliasNameCollisions.map((collision) => ({
      kind: 'alias-name' as const,
      value: collision.normalizedValue,
      companyRefs: [
        state.companies.find((row) => row.id === collision.aliasCompany.id)!
          .ref,
        state.companies.find((row) => row.id === collision.nameCompany.id)!.ref
      ],
      blocking: false
    })),
    ...inventory.sharedAliases.map((collision) => ({
      kind: 'shared-alias' as const,
      value: collision.value,
      companyRefs: collision.companies.map(
        (company) => state.companies.find((row) => row.id === company.id)!.ref
      ),
      blocking: false
    })),
    ...inventory.externalIdConflicts.map((collision) => ({
      kind: 'external-id' as const,
      value: collision.value,
      companyRefs: collision.companies.map(
        (company) => state.companies.find((row) => row.id === company.id)!.ref
      ),
      blocking: true
    }))
  ]
}

export const buildCompanyInventory = (
  state: CompanyDatabaseState,
  now = new Date()
): CompanyInventory =>
  companyInventorySchema.parse({
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    toolVersion: COMPANY_CLEANUP_TOOL_VERSION,
    generatedCommit: getCurrentGitCommit(),
    generatedAt: now.toISOString(),
    databaseDigest: digestCompanyDatabaseState(state),
    companies: state.companies,
    collisions: buildInventoryCollisions(state)
  })

export const writeCompanyInventory = async (
  db: PrismaClient,
  outputPath: string
) => {
  const state = await loadCompanyDatabaseState(db)
  const inventory = buildCompanyInventory(state)
  return writeCanonicalArtifact(outputPath, inventory, { sidecar: true })
}

const fetchVndbEvidence = async (
  state: CompanyDatabaseState,
  fetchCandidates: (vndbId: string) => Promise<TrustedCompanyCandidate[]>
) => {
  const vndbIds = unique(
    state.companies.flatMap((company) =>
      company.relations
        .map((relation) => relation.vndbId)
        .filter((value): value is string => Boolean(value))
    )
  )
  const candidatesByVndbId = new Map<string, TrustedCompanyCandidate[]>()
  const warnings: string[] = []
  let nextIndex = 0
  const worker = async () => {
    for (;;) {
      const index = nextIndex++
      if (index >= vndbIds.length) return
      const vndbId = vndbIds[index]
      try {
        candidatesByVndbId.set(vndbId, await fetchCandidates(vndbId))
      } catch (error) {
        warnings.push(
          `VNDB evidence fetch failed for ${vndbId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(VNDB_FETCH_CONCURRENCY, vndbIds.length) },
      () => worker()
    )
  )
  return { candidatesByVndbId, warnings }
}

const buildAutomaticMergeInputs = (
  state: CompanyDatabaseState,
  evidenceActions: CompanyCleanupPlan['evidenceActions'],
  manuallyConsumedSourceIds: Set<number>
) => {
  const automatic = buildAuthoritativeAliasCompanyMergePlan(
    state.companies.map(toMaintenanceCompany),
    evidenceActions
  )
  const blockers: string[] = []
  const warnings = [...automatic.warnings]
  const inputs: Array<{
    kind: 'automatic'
    targetCompanyId: number
    sourceCompanyIds: number[]
    ownerFromCompanyId: number
    introductionFromCompanyId: number
    reason: string
  }> = []
  const byId = new Map(state.companies.map((company) => [company.id, company]))
  for (const merge of automatic.merges) {
    if (
      merge.sourceCompanyIds.some((id) => manuallyConsumedSourceIds.has(id))
    ) {
      continue
    }
    const target = byId.get(merge.targetCompanyId)!
    const sources = merge.sourceCompanyIds.map((id) => byId.get(id)!)
    const ownerRefs = unique(
      [target, ...sources].map((company) => company.ownerRef)
    )
    const nonemptyIntroductions = unique(
      [target, ...sources]
        .map((company) => company.introduction.trim())
        .filter(Boolean)
    )
    if (ownerRefs.length > 1 || nonemptyIntroductions.length > 1) {
      blockers.push(
        `Automatic merge into #${target.id} needs an explicit owner/introduction decision for sources ${merge.sourceCompanyIds.map((id) => `#${id}`).join(', ')}`
      )
      continue
    }
    const introductionSource =
      [target, ...sources].find((company) => company.introduction.trim()) ??
      target
    inputs.push({
      kind: 'automatic',
      targetCompanyId: target.id,
      sourceCompanyIds: merge.sourceCompanyIds,
      ownerFromCompanyId: target.id,
      introductionFromCompanyId: introductionSource.id,
      reason: 'One authoritative alias resolves the source main name'
    })
  }
  return { inputs, blockers, warnings }
}

export const generateFrozenCompanyCleanupPlan = async (input: {
  db: PrismaClient
  inventoryPath: string
  decisionsPath: string
  outputPath: string
  manualOnly?: boolean
  now?: Date
  fetchVndbCandidates?: (vndbId: string) => Promise<TrustedCompanyCandidate[]>
}) => {
  const inventoryArtifact = await readArtifactWithVerifiedSidecar(
    input.inventoryPath
  )
  const inventory = companyInventorySchema.parse(
    JSON.parse(inventoryArtifact.raw)
  )
  if (serializeCanonicalJson(inventory) !== inventoryArtifact.raw) {
    throw new Error('Company inventory is not canonical JSON')
  }
  if (inventory.generatedCommit !== getCurrentGitCommit()) {
    throw new Error('Inventory must be consumed by its exact generating commit')
  }
  const rawDecisions = await readProtectedArtifact(input.decisionsPath)
  const decisions = companyCleanupDecisionsSchema.parse(
    JSON.parse(rawDecisions)
  )
  if (serializeCanonicalJson(decisions) !== rawDecisions) {
    throw new Error('Company cleanup decisions are not canonical JSON')
  }
  if (decisions.inventorySha256 !== inventoryArtifact.digest) {
    throw new Error('Decisions do not belong to the supplied inventory')
  }

  const snapshotA = await loadCompanyDatabaseState(input.db)
  const digestA = digestCompanyDatabaseState(snapshotA)
  if (digestA !== inventory.databaseDigest) {
    throw new Error('Live database no longer matches the reviewed inventory')
  }

  // Manual-only plans freeze explicitly reviewed decisions without enriching
  // unrelated companies or consulting external evidence.
  const fetched = input.manualOnly
    ? { candidatesByVndbId: new Map(), warnings: [] }
    : await fetchVndbEvidence(
        snapshotA,
        input.fetchVndbCandidates ?? fetchVerifiedVndbCompanyCandidates
      )

  const snapshotB = await loadCompanyDatabaseState(input.db)
  const digestB = digestCompanyDatabaseState(snapshotB)
  if (digestA !== digestB) {
    throw new Error(
      input.manualOnly
        ? 'Database changed while reviewed company decisions were planned'
        : 'Database changed while external company evidence was fetched'
    )
  }

  const evidencePlan = input.manualOnly
    ? { actions: [], warnings: [] }
    : planAuthoritativeVndbCompanyEvidence(
        snapshotA.companies.map((company) => ({
          company: toMaintenanceCompany(company),
          candidates: company.relations.flatMap((relation) =>
            relation.vndbId
              ? (fetched.candidatesByVndbId.get(relation.vndbId) ?? [])
              : []
          )
        }))
      )
  const resolved = resolveDecisionCompanyIds(snapshotA, decisions)
  const manuallyConsumed = new Set(
    resolved.merges.flatMap((merge) => merge.sourceCompanyIds)
  )
  const automatic = input.manualOnly
    ? { inputs: [], blockers: [], warnings: [] }
    : buildAutomaticMergeInputs(
        snapshotA,
        evidencePlan.actions,
        manuallyConsumed
      )
  const mergeInputs = [...resolved.merges, ...automatic.inputs]
  validateActionTopology(
    mergeInputs,
    resolved.deletions.map((deletion) => deletion.companyId)
  )

  const actionCount =
    evidencePlan.actions.length + mergeInputs.length + resolved.deletions.length
  if (actionCount > COMPANY_CLEANUP_MAX_ACTIONS) {
    throw new Error(
      `Company cleanup plan exceeds ${COMPANY_CLEANUP_MAX_ACTIONS} actions`
    )
  }
  const blockers = [
    ...automatic.blockers,
    ...fetched.warnings.map(
      (warning) => `External evidence is incomplete: ${warning}`
    )
  ]
  let expectedPostState = snapshotA
  let mergeActions: CompanyCleanupPlan['mergeActions'] = []
  try {
    const simulated = applyActionsToCompanyDatabaseState(
      snapshotA,
      evidencePlan.actions,
      mergeInputs,
      resolved.deletions
    )
    expectedPostState = simulated.state
    mergeActions = simulated.mergeActions
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error))
  }

  const companyIds = unique([
    ...evidencePlan.actions.map((action) => action.companyId),
    ...mergeInputs.flatMap((merge) => [
      merge.targetCompanyId,
      ...merge.sourceCompanyIds
    ]),
    ...resolved.deletions.map((deletion) => deletion.companyId)
  ]).sort((left, right) => left - right)
  const relationCount = snapshotA.companies
    .filter((company) => companyIds.includes(company.id))
    .reduce((sum, company) => sum + company.relations.length, 0)
  if (relationCount > COMPANY_CLEANUP_MAX_RELATIONS) {
    throw new Error(
      `Company cleanup plan exceeds ${COMPANY_CLEANUP_MAX_RELATIONS} relations`
    )
  }
  const patchUniqueIds = unique(
    snapshotA.companies
      .filter((company) => companyIds.includes(company.id))
      .flatMap((company) =>
        company.relations.map((relation) => relation.patchUniqueId)
      )
  ).sort((left, right) => left.localeCompare(right, 'en'))

  const plan: CompanyCleanupPlan = {
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    toolVersion: COMPANY_CLEANUP_TOOL_VERSION,
    normalizationVersion: COMPANY_NORMALIZATION_VERSION,
    generatedCommit: getCurrentGitCommit(),
    generatedAt: (input.now ?? new Date()).toISOString(),
    inventorySha256: inventoryArtifact.digest,
    preDatabaseDigest: digestA,
    expectedPostDatabaseDigest:
      digestSemanticCompanyDatabaseState(expectedPostState),
    preState: snapshotA,
    expectedPostState,
    evidenceActions: evidencePlan.actions,
    mergeActions,
    deleteActions: resolved.deletions,
    blockers,
    warnings: [
      ...(input.manualOnly
        ? [
            'Manual-only plan: VNDB evidence and automatic merges were intentionally skipped'
          ]
        : []),
      ...fetched.warnings,
      ...evidencePlan.warnings,
      ...automatic.warnings
    ],
    cacheTargets: {
      companyIds,
      patchUniqueIds,
      pagePaths: unique([
        '/',
        '/otomegame',
        '/company',
        ...companyIds.map((companyId) => `/company/${companyId}`),
        ...patchUniqueIds.map((uniqueId) => `/${uniqueId}`)
      ]),
      apiPrefixes: ['/api/home', '/api/company/otomegame']
    },
    limits: { actions: actionCount, relations: relationCount }
  }

  const validatedPlan = companyCleanupPlanSchema.parse(plan)
  const planDigest = await writeCanonicalArtifact(
    input.outputPath,
    validatedPlan,
    {
      sidecar: true
    }
  )
  return { plan: validatedPlan, planDigest }
}

export const buildEmptyDecisionsTemplate = (inventoryRaw: string): string =>
  serializeCanonicalJson({
    schemaVersion: COMPANY_CLEANUP_SCHEMA_VERSION,
    inventorySha256: sha256Bytes(inventoryRaw),
    merges: [],
    deletions: []
  })
