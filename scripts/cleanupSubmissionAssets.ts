import 'dotenv/config'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { SubmissionTakedownOutcome } from '~/app/api/patch-submission/assetCleanup'
import type { SubmissionOrphanCleanupResult } from '~/app/api/patch-submission/orphanCleanup'

/**
 * Audits and, only with --apply, retries all patch-submission asset cleanup.
 *
 * Priority is deliberate: cleanup-state rows are the authoritative grouped
 * outbox, then already-persisted single-key orphan jobs, then newly discovered
 * S3 orphans. A new orphan is persisted before any external deletion begins.
 */
const SUBMISSION_ASSET_PREFIX = 'patch-submission/'
const DEFAULT_GRACE_HOURS = 24
const DEFAULT_BATCH_SIZE = 200

export interface SubmissionAssetCleanupOptions {
  apply: boolean
  graceHours: number
  limit?: number
}

export interface CleanupSubmissionCandidate {
  id: number
  keys: string[]
}

interface CleanupSubmissionResult {
  attempted: number
  done: number
  owed: number
  skipped: number
  bookkeepingFailed: number
}

export interface SubmissionAssetCleanupResult {
  scanned: number
  servingReferenced: number
  withinGrace: number
  cleanupSubmissionIds: number[]
  orphanJobKeys: string[]
  newOrphans: string[]
  enqueued: number
  cleanupSubmissions: CleanupSubmissionResult
  orphanJobs: SubmissionOrphanCleanupResult
}

export const parseSubmissionAssetCleanupOptions = (
  args: string[]
): SubmissionAssetCleanupOptions => {
  const readNumber = (flag: string) => {
    const index = args.indexOf(flag)
    if (index < 0) return undefined
    const value = Number(args[index + 1])
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  return {
    apply: args.includes('--apply'),
    graceHours: readNumber('--grace-hours') ?? DEFAULT_GRACE_HOURS,
    limit: readNumber('--limit')
  }
}

export interface SubmissionAssetCleanupDependencies {
  listKeys: () => Promise<{ key: string; lastModified?: Date }[]>
  loadServingKeys: () => Promise<Set<string>>
  loadCleanupSubmissions: () => Promise<CleanupSubmissionCandidate[]>
  loadOrphanJobKeys: () => Promise<string[]>
  takeDownSubmission: (submissionId: number) => Promise<SubmissionTakedownOutcome>
  enqueueOrphans: (keys: string[]) => Promise<string[]>
  processOrphanJobs: (
    keys: string[]
  ) => Promise<SubmissionOrphanCleanupResult>
  close: () => Promise<void>
}

const emptyCleanupSubmissionResult = (): CleanupSubmissionResult => ({
  attempted: 0,
  done: 0,
  owed: 0,
  skipped: 0,
  bookkeepingFailed: 0
})

const emptyOrphanJobResult = (): SubmissionOrphanCleanupResult => ({
  scanned: 0,
  done: 0,
  owed: 0,
  cancelled: 0,
  bookkeepingFailed: 0
})

const addOrphanJobResult = (
  target: SubmissionOrphanCleanupResult,
  next: SubmissionOrphanCleanupResult
) => {
  target.scanned += next.scanned
  target.done += next.done
  target.owed += next.owed
  target.cancelled += next.cancelled
  target.bookkeepingFailed += next.bookkeepingFailed
}

const countSubmissionOutcome = (
  summary: CleanupSubmissionResult,
  outcome: SubmissionTakedownOutcome
) => {
  summary.attempted += 1
  if (outcome.status === 'done') summary.done += 1
  if (outcome.status === 'owed') summary.owed += 1
  if (outcome.status === 'skipped') summary.skipped += 1
  if (outcome.status === 'bookkeeping-failed') {
    summary.bookkeepingFailed += 1
  }
}

export const runSubmissionAssetCleanup = async (
  options: SubmissionAssetCleanupOptions,
  dependencies: SubmissionAssetCleanupDependencies
): Promise<SubmissionAssetCleanupResult> => {
  const [cleanupCandidates, initialJobKeys] = await Promise.all([
    dependencies.loadCleanupSubmissions(),
    dependencies.loadOrphanJobKeys()
  ])
  const result: SubmissionAssetCleanupResult = {
    scanned: 0,
    servingReferenced: 0,
    withinGrace: 0,
    cleanupSubmissionIds: cleanupCandidates.map(({ id }) => id),
    orphanJobKeys: initialJobKeys,
    newOrphans: [],
    enqueued: 0,
    cleanupSubmissions: emptyCleanupSubmissionResult(),
    orphanJobs: emptyOrphanJobResult()
  }

  let remaining = options.limit ?? Number.POSITIVE_INFINITY

  if (options.apply) {
    for (const candidate of cleanupCandidates.slice(0, remaining)) {
      const outcome = await dependencies.takeDownSubmission(candidate.id)
      countSubmissionOutcome(result.cleanupSubmissions, outcome)
      remaining -= 1
    }

    const persistedToProcess = initialJobKeys.slice(0, remaining)
    if (persistedToProcess.length) {
      addOrphanJobResult(
        result.orphanJobs,
        await dependencies.processOrphanJobs(persistedToProcess)
      )
      remaining -= persistedToProcess.length
    }
  }

  // Reload after apply: completed/cancelled jobs are gone, while owed jobs must
  // remain a separate class instead of being rediscovered as new S3 orphans.
  const currentJobKeys = options.apply
    ? await dependencies.loadOrphanJobKeys()
    : initialJobKeys
  const [objects, serving] = await Promise.all([
    dependencies.listKeys(),
    dependencies.loadServingKeys()
  ])
  result.scanned = objects.length

  const rowOutboxKeys = new Set(
    cleanupCandidates.flatMap((candidate) => candidate.keys)
  )
  const existingJobKeys = new Set(currentJobKeys)
  const graceCutoff = Date.now() - options.graceHours * 60 * 60 * 1000

  for (const object of objects) {
    if (serving.has(object.key)) {
      result.servingReferenced += 1
      continue
    }
    if (rowOutboxKeys.has(object.key) || existingJobKeys.has(object.key)) {
      continue
    }
    if (object.lastModified && object.lastModified.getTime() > graceCutoff) {
      result.withinGrace += 1
      continue
    }
    if (result.newOrphans.length >= remaining) break
    result.newOrphans.push(object.key)
  }

  if (options.apply && result.newOrphans.length) {
    const enqueued = await dependencies.enqueueOrphans(result.newOrphans)
    result.enqueued = enqueued.length
    if (enqueued.length) {
      addOrphanJobResult(
        result.orphanJobs,
        await dependencies.processOrphanJobs(enqueued)
      )
    }
  }

  return result
}

export const printSubmissionAssetCleanupSummary = (
  options: SubmissionAssetCleanupOptions,
  result: SubmissionAssetCleanupResult
) => {
  console.log(
    [
      `scanned=${result.scanned}`,
      `serving=${result.servingReferenced}`,
      `within-grace=${result.withinGrace}`,
      `cleanup-rows=${result.cleanupSubmissionIds.length}`,
      `persisted-orphan-jobs=${result.orphanJobKeys.length}`,
      `new-orphans=${result.newOrphans.length}`,
      options.apply
        ? `row-done=${result.cleanupSubmissions.done}`
        : 'row-done=0 (dry-run)',
      options.apply ? `job-done=${result.orphanJobs.done}` : 'job-done=0 (dry-run)',
      options.apply ? `job-owed=${result.orphanJobs.owed}` : 'job-owed=0 (dry-run)'
    ].join(' ')
  )

  for (const id of result.cleanupSubmissionIds.slice(0, 20)) {
    console.log(`  cleanup-row submission=${id}`)
  }
  for (const key of result.orphanJobKeys.slice(0, 20)) {
    console.log(`  persisted-orphan ${key}`)
  }
  for (const key of result.newOrphans.slice(0, 20)) {
    console.log(`  new-orphan ${key}`)
  }
}

export const createSubmissionAssetCleanupDependencies = async (): Promise<
  SubmissionAssetCleanupDependencies
> => {
  const { s3 } = await import('~/lib/s3')
  const { prisma } = await import('~/prisma/index')
  const { PATCH_SUBMISSION_CLEANUP_STATUSES } = await import(
    '~/constants/patchSubmission'
  )
  const { collectSubmissionAssetKeys, takeDownSubmissionAssets } = await import(
    '~/app/api/patch-submission/assetCleanup'
  )
  const {
    enqueueSubmissionOrphanCleanupJobs,
    loadServingSubmissionAssetKeys,
    processSubmissionOrphanCleanupJobs
  } = await import('~/app/api/patch-submission/orphanCleanup')

  return {
    listKeys: async () => {
      const keys: { key: string; lastModified?: Date }[] = []
      let token: string | undefined

      do {
        const response = await s3.send(
          new ListObjectsV2Command({
            Bucket: process.env.KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME!,
            Prefix: SUBMISSION_ASSET_PREFIX,
            ContinuationToken: token,
            MaxKeys: DEFAULT_BATCH_SIZE
          })
        )
        for (const object of response.Contents ?? []) {
          if (object.Key) {
            keys.push({ key: object.Key, lastModified: object.LastModified })
          }
        }
        token = response.NextContinuationToken
      } while (token)

      return keys
    },

    loadServingKeys: () => loadServingSubmissionAssetKeys(),

    loadCleanupSubmissions: async () => {
      const rows = await prisma.patch_submission.findMany({
        where: {
          status: { in: [...PATCH_SUBMISSION_CLEANUP_STATUSES] },
          OR: [
            { banner_key: { not: null } },
            { banner_thumbnail_key: { not: null } },
            { banner_original_key: { not: null } },
            { gallery: { some: {} } }
          ]
        },
        orderBy: [{ settled_at: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          banner_key: true,
          banner_thumbnail_key: true,
          banner_original_key: true,
          gallery: { select: { image_key: true, thumbnail_key: true } }
        }
      })
      return rows.map((row) => ({
        id: row.id,
        keys: collectSubmissionAssetKeys(row)
      }))
    },

    loadOrphanJobKeys: async () => {
      const rows = await prisma.patch_submission_orphan_cleanup.findMany({
        orderBy: [{ created: 'asc' }, { id: 'asc' }],
        select: { object_key: true }
      })
      return rows.map(({ object_key }) => object_key)
    },

    takeDownSubmission: (submissionId) =>
      takeDownSubmissionAssets(submissionId),

    enqueueOrphans: (keys) =>
      prisma.$transaction((tx) =>
        enqueueSubmissionOrphanCleanupJobs(tx, keys, 'orphan_scan')
      ),

    processOrphanJobs: (keys) =>
      processSubmissionOrphanCleanupJobs({
        limit: keys.length,
        objectKeys: keys
      }),

    close: async () => {
      await prisma.$disconnect()
    }
  }
}

const shouldRunCli = () => {
  const entry = process.argv[1]
  return Boolean(entry && import.meta.url === pathToFileURL(resolve(entry)).href)
}

if (shouldRunCli()) {
  const options = parseSubmissionAssetCleanupOptions(process.argv.slice(2))
  let dependencies: SubmissionAssetCleanupDependencies | undefined

  createSubmissionAssetCleanupDependencies()
    .then(async (created) => {
      dependencies = created
      console.log(
        `Running submission asset cleanup in ${
          options.apply ? 'apply' : 'dry-run'
        } mode with graceHours=${options.graceHours}, limit=${
          options.limit ?? 'all'
        }.`
      )
      const result = await runSubmissionAssetCleanup(options, dependencies)
      printSubmissionAssetCleanupSummary(options, result)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await dependencies?.close()
    })
}
