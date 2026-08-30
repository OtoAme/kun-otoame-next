import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  link,
  stat,
  unlink
} from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'

export const COMPANY_CLEANUP_SCHEMA_VERSION = 1 as const
export const COMPANY_CLEANUP_TOOL_VERSION = 'company-cleanup-frozen-v1'
export const COMPANY_NORMALIZATION_VERSION = 'nfkc-lowercase-whitespace-v1'
export const COMPANY_CLEANUP_MAX_ACTIONS = 100
export const COMPANY_CLEANUP_MAX_RELATIONS = 5000

const nonEmptyString = z.string().trim().min(1)
const id = z.number().int().positive()
const isoDate = z.string().datetime({ offset: true })
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const companyExternalIdSchema = z
  .object({
    source: nonEmptyString.max(32),
    externalId: nonEmptyString.max(107)
  })
  .strict()

export const companyIdentitySchema = z
  .object({
    kind: z.enum(['name', 'alias']),
    origin: z.enum(['authoritative', 'legacy']),
    value: nonEmptyString.max(107),
    normalizedValue: nonEmptyString.max(107),
    confirmedByRef: nonEmptyString.nullable()
  })
  .strict()

export const companyRelationSchema = z
  .object({
    patchId: id,
    patchUniqueId: nonEmptyString,
    vndbId: z.string().nullable()
  })
  .strict()

export const companyStateSchema = z
  .object({
    id,
    ref: nonEmptyString,
    name: nonEmptyString.max(107),
    normalizedName: z.string().max(107).nullable(),
    introduction: z.string().max(10007),
    count: z.number().int().nonnegative(),
    primaryLanguage: z.array(nonEmptyString),
    sourceWebsites: z.array(nonEmptyString),
    parentBrands: z.array(nonEmptyString),
    aliases: z.array(nonEmptyString.max(107)),
    ownerRef: nonEmptyString,
    updated: isoDate,
    externalIds: z.array(companyExternalIdSchema),
    identities: z.array(companyIdentitySchema),
    relations: z.array(companyRelationSchema)
  })
  .strict()

export const companyDatabaseStateSchema = z
  .object({ companies: z.array(companyStateSchema) })
  .strict()

const inventoryCollisionSchema = z
  .object({
    kind: z.enum([
      'missing-normalized-name',
      'normalized-name',
      'alias-name',
      'shared-alias',
      'external-id'
    ]),
    value: z.string(),
    companyRefs: z.array(nonEmptyString),
    blocking: z.boolean()
  })
  .strict()

export const companyInventorySchema = z
  .object({
    schemaVersion: z.literal(COMPANY_CLEANUP_SCHEMA_VERSION),
    toolVersion: z.literal(COMPANY_CLEANUP_TOOL_VERSION),
    generatedCommit: z.string().regex(/^[a-f0-9]{40}$/),
    generatedAt: isoDate,
    databaseDigest: sha256,
    companies: z.array(companyStateSchema),
    collisions: z.array(inventoryCollisionSchema)
  })
  .strict()

const mergeDecisionSchema = z
  .object({
    targetCompanyRef: nonEmptyString,
    sourceCompanyRefs: z.array(nonEmptyString).min(1),
    ownerFromCompanyRef: nonEmptyString,
    introductionFromCompanyRef: nonEmptyString,
    reason: nonEmptyString.max(1000)
  })
  .strict()

const deleteDecisionSchema = z
  .object({ companyRef: nonEmptyString, reason: nonEmptyString.max(1000) })
  .strict()

export const companyCleanupDecisionsSchema = z
  .object({
    schemaVersion: z.literal(COMPANY_CLEANUP_SCHEMA_VERSION),
    inventorySha256: sha256,
    merges: z.array(mergeDecisionSchema),
    deletions: z.array(deleteDecisionSchema)
  })
  .strict()

export const companyEvidenceActionSchema = z
  .object({
    companyId: id,
    source: z.enum(['vndb', 'bangumi', 'steam', 'dlsite']),
    externalId: nonEmptyString.max(107),
    authoritativeValues: z.array(nonEmptyString.max(107)).min(1)
  })
  .strict()

export const companyMergeActionSchema = z
  .object({
    kind: z.enum(['automatic', 'manual']),
    targetCompanyId: id,
    sourceCompanyIds: z.array(id).min(1),
    ownerFromCompanyId: id,
    introductionFromCompanyId: id,
    reason: nonEmptyString.max(1000),
    expectedTarget: companyStateSchema
  })
  .strict()

export const companyDeleteActionSchema = z
  .object({ companyId: id, reason: nonEmptyString.max(1000) })
  .strict()

export const companyCleanupPlanSchema = z
  .object({
    schemaVersion: z.literal(COMPANY_CLEANUP_SCHEMA_VERSION),
    toolVersion: z.literal(COMPANY_CLEANUP_TOOL_VERSION),
    normalizationVersion: z.literal(COMPANY_NORMALIZATION_VERSION),
    generatedCommit: z.string().regex(/^[a-f0-9]{40}$/),
    generatedAt: isoDate,
    inventorySha256: sha256,
    preDatabaseDigest: sha256,
    expectedPostDatabaseDigest: sha256,
    preState: companyDatabaseStateSchema,
    expectedPostState: companyDatabaseStateSchema,
    evidenceActions: z.array(companyEvidenceActionSchema),
    mergeActions: z.array(companyMergeActionSchema),
    deleteActions: z.array(companyDeleteActionSchema),
    blockers: z.array(nonEmptyString),
    warnings: z.array(nonEmptyString),
    cacheTargets: z
      .object({
        companyIds: z.array(id),
        patchUniqueIds: z.array(nonEmptyString),
        pagePaths: z.array(nonEmptyString),
        apiPrefixes: z.array(nonEmptyString)
      })
      .strict(),
    limits: z
      .object({
        actions: z
          .number()
          .int()
          .nonnegative()
          .max(COMPANY_CLEANUP_MAX_ACTIONS),
        relations: z
          .number()
          .int()
          .nonnegative()
          .max(COMPANY_CLEANUP_MAX_RELATIONS)
      })
      .strict()
  })
  .strict()

export const companyCleanupReceiptSchema = z
  .object({
    schemaVersion: z.literal(COMPANY_CLEANUP_SCHEMA_VERSION),
    toolVersion: z.literal(COMPANY_CLEANUP_TOOL_VERSION),
    planSha256: sha256,
    expectedPostDatabaseDigest: sha256,
    databaseStatus: z.enum(['applied', 'already-applied']),
    committedAt: isoDate,
    cache: z
      .object({
        status: z.enum(['pending', 'complete', 'failed']),
        attemptedAt: isoDate.nullable(),
        redis: z.enum(['pending', 'complete', 'failed']),
        cloudflare: z.enum(['pending', 'complete', 'failed']),
        isr: z.literal('deferred-to-deploy'),
        detail: z.string().nullable()
      })
      .strict()
  })
  .strict()

export type CompanyState = z.infer<typeof companyStateSchema>
export type CompanyDatabaseState = z.infer<typeof companyDatabaseStateSchema>
export type CompanyInventory = z.infer<typeof companyInventorySchema>
export type CompanyCleanupDecisions = z.infer<
  typeof companyCleanupDecisionsSchema
>
export type CompanyCleanupPlan = z.infer<typeof companyCleanupPlanSchema>
export type CompanyCleanupReceipt = z.infer<typeof companyCleanupReceiptSchema>

const compareCanonical = (left: unknown, right: unknown) =>
  JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')

export const canonicalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue).sort(compareCanonical)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, nested]) => [key, canonicalizeJsonValue(nested)])
    )
  }
  return value
}

export const serializeCanonicalJson = (value: unknown) =>
  `${JSON.stringify(canonicalizeJsonValue(value), null, 2)}\n`

export const sha256Bytes = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')

export const digestCompanyDatabaseState = (state: CompanyDatabaseState) =>
  sha256Bytes(serializeCanonicalJson(state))

export const getCurrentGitCommit = () =>
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()

const pathIsWithin = (parent: string, child: string) => {
  const childRelative = relative(parent, child)
  return (
    childRelative === '' ||
    (!childRelative.startsWith('..') && !isAbsolute(childRelative))
  )
}

const getGitWorktreeRoots = () => {
  try {
    return execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length)))
  } catch {
    return [resolve(process.cwd())]
  }
}

const assertNoSymlinkSegments = async (targetPath: string) => {
  let current = resolve(targetPath)
  const segments: string[] = []
  for (;;) {
    segments.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const segment of segments.reverse()) {
    try {
      const details = await lstat(segment)
      if (details.isSymbolicLink()) {
        throw new Error(
          `Maintenance artifact path cannot contain symlinks: ${segment}`
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

const assertSafeArtifactDirectory = async (filePath: string) => {
  const resolvedPath = resolve(filePath)
  const parent = dirname(resolvedPath)
  await assertNoSymlinkSegments(resolvedPath)
  const parentDetails = await stat(parent)
  if (!parentDetails.isDirectory()) {
    throw new Error(`Maintenance artifact parent is not a directory: ${parent}`)
  }
  if ((parentDetails.mode & 0o077) !== 0) {
    throw new Error(
      `Maintenance artifact directory must not be group/world accessible: ${parent}`
    )
  }
  const realParent = await realpath(parent)
  for (const worktreeRoot of getGitWorktreeRoots()) {
    let realRoot = worktreeRoot
    try {
      realRoot = await realpath(worktreeRoot)
    } catch {
      // A removed worktree cannot contain the destination.
    }
    if (pathIsWithin(realRoot, realParent)) {
      throw new Error(
        'Maintenance artifacts must be stored outside every Git worktree'
      )
    }
  }
  return resolvedPath
}

export const writeProtectedArtifact = async (
  filePath: string,
  contents: string,
  options: { replace?: boolean } = {}
) => {
  const target = await assertSafeArtifactDirectory(filePath)
  if (!options.replace) {
    try {
      await lstat(target)
      throw new Error(`Refusing to overwrite maintenance artifact: ${target}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  } else {
    try {
      const existing = await lstat(target)
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error(`Refusing to replace non-regular artifact: ${target}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(tempPath, 0o600)
  try {
    if (options.replace) {
      await rename(tempPath, target)
    } else {
      await link(tempPath, target)
      await unlink(tempPath)
    }
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export const writeCanonicalArtifact = async (
  filePath: string,
  value: unknown,
  options: { replace?: boolean; sidecar?: boolean } = {}
) => {
  const serialized = serializeCanonicalJson(value)
  if (options.sidecar && !options.replace) {
    try {
      await lstat(`${resolve(filePath)}.sha256`)
      throw new Error(
        `Refusing to overwrite maintenance artifact: ${resolve(filePath)}.sha256`
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await writeProtectedArtifact(filePath, serialized, options)
  const digest = sha256Bytes(serialized)
  if (options.sidecar) {
    await writeProtectedArtifact(`${filePath}.sha256`, `${digest}\n`, options)
  }
  return digest
}

export const readProtectedArtifact = async (filePath: string) => {
  const target = await assertSafeArtifactDirectory(filePath)
  const details = await lstat(target)
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Maintenance artifact must be a regular file: ${target}`)
  }
  if ((details.mode & 0o077) !== 0) {
    throw new Error(
      `Maintenance artifact must use private permissions: ${target}`
    )
  }
  return readFile(target, 'utf8')
}

export const readPlanWithVerifiedSidecar = async (filePath: string) => {
  const { raw: rawPlan, digest } =
    await readArtifactWithVerifiedSidecar(filePath)
  const plan = companyCleanupPlanSchema.parse(JSON.parse(rawPlan))
  if (serializeCanonicalJson(plan) !== rawPlan) {
    throw new Error('Company cleanup plan is not canonical JSON')
  }
  if (plan.toolVersion !== COMPANY_CLEANUP_TOOL_VERSION) {
    throw new Error(
      'Company cleanup plan was generated by a different tool version'
    )
  }
  if (plan.generatedCommit !== getCurrentGitCommit()) {
    throw new Error(
      'Company cleanup plan must be consumed by its exact generating commit'
    )
  }
  return { plan, digest, rawPlan }
}

export const readArtifactWithVerifiedSidecar = async (filePath: string) => {
  const [raw, rawSidecar] = await Promise.all([
    readProtectedArtifact(filePath),
    readProtectedArtifact(`${filePath}.sha256`)
  ])
  const digest = sha256Bytes(raw)
  if (rawSidecar.trim() !== digest) {
    throw new Error('Maintenance artifact SHA-256 sidecar mismatch')
  }
  return { raw, digest }
}

export const getReceiptPath = (planPath: string) => `${planPath}.receipt.json`
