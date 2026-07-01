import 'dotenv/config'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_DRY_LIMIT = 200
const DEFAULT_APPLY_LIMIT = 100
const DEFAULT_APPLY_DELAY_MS = 1000
const MAX_BATCH_SIZE = 200
const MAX_CONCURRENCY = 4
const DEFAULT_OLDER_THAN_HOURS = 2
const MIN_OLDER_THAN_HOURS = 2
const MAX_OLDER_THAN_HOURS = 24 * 30

export interface ConversationImageCleanupOptions {
  apply: boolean
  prefix: string
  batchSize: number
  concurrency: number
  delayMs: number
  limit?: number
  olderThanHours: number
  verbose: boolean
}

export interface ConversationImageCleanupObject {
  key: string
  lastModified: Date | null
  size?: number
}

export interface ConversationImageCleanupListResult {
  objects: ConversationImageCleanupObject[]
  nextContinuationToken?: string
}

export interface ConversationImageCleanupDependencies {
  listObjects: (args: {
    prefix: string
    continuationToken?: string
    maxKeys: number
  }) => Promise<ConversationImageCleanupListResult>
  findReferencedKeys: (keys: string[]) => Promise<Set<string>>
  deleteObject: (key: string) => Promise<void>
  now: () => Date
}

export interface ConversationImageCleanupRunResult {
  scanned: number
  eligible: number
  deleted: number
  referenced: number
  tooNew: number
  invalidKey: number
  failed: number
  candidates: string[]
  failures: { key: string; reason: string }[]
}

const CONVERSATION_IMAGE_KEY_PATTERN =
  /^conversation\/\d+\/\d+-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.avif$/i

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const parseIntegerArg = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.floor(parsed)
}

const getArgValue = (args: string[], name: string) => {
  const prefix = `${name}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const isCanonicalConversationImageKey = (key: string) =>
  CONVERSATION_IMAGE_KEY_PATTERN.test(key)

export const buildConversationImageCleanupOptions = (
  args = process.argv.slice(2)
): ConversationImageCleanupOptions => {
  const apply = args.includes('--apply')
  const limitArg = parseIntegerArg(getArgValue(args, '--limit'))
  const batchArg = parseIntegerArg(getArgValue(args, '--batch'))
  const concurrencyArg = parseIntegerArg(getArgValue(args, '--concurrency'))
  const delayArg = parseIntegerArg(getArgValue(args, '--delay'))
  const olderThanArg = parseIntegerArg(getArgValue(args, '--older-than-hours'))
  const conversationIdArg = parseIntegerArg(getArgValue(args, '--conversation-id'))

  return {
    apply,
    prefix:
      conversationIdArg && conversationIdArg > 0
        ? `conversation/${conversationIdArg}/`
        : 'conversation/',
    batchSize: clamp(batchArg ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    concurrency: clamp(concurrencyArg ?? 1, 1, MAX_CONCURRENCY),
    delayMs: clamp(delayArg ?? (apply ? DEFAULT_APPLY_DELAY_MS : 0), 0, 60_000),
    limit:
      limitArg === undefined
        ? apply
          ? DEFAULT_APPLY_LIMIT
          : DEFAULT_DRY_LIMIT
        : limitArg > 0
          ? limitArg
          : undefined,
    olderThanHours: clamp(
      olderThanArg ?? DEFAULT_OLDER_THAN_HOURS,
      MIN_OLDER_THAN_HOURS,
      MAX_OLDER_THAN_HOURS
    ),
    verbose: args.includes('--verbose')
  }
}

export const createConversationImageCleanupDependencies = async (): Promise<
  ConversationImageCleanupDependencies & { close: () => Promise<void> }
> => {
  const pg = await import('pg')
  const { Prisma, PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { s3, deleteFileFromS3 } = await import('~/lib/s3')

  const Pool = pg.default?.Pool ?? pg.Pool
  const pool = new Pool({
    connectionString: process.env.KUN_DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  return {
    listObjects: async ({ prefix, continuationToken, maxKeys }) => {
      const result = await s3.send(
        new ListObjectsV2Command({
          Bucket: process.env.KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME!,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: maxKeys
        })
      )

      return {
        objects:
          result.Contents?.flatMap((object) =>
            object.Key
              ? [
                  {
                    key: object.Key,
                    lastModified: object.LastModified ?? null,
                    size: object.Size
                  }
                ]
              : []
          ) ?? [],
        nextContinuationToken: result.NextContinuationToken
      }
    },
    findReferencedKeys: async (keys) => {
      if (keys.length === 0) {
        return new Set()
      }

      const values = Prisma.join(keys.map((key) => Prisma.sql`(${key})`))
      const rows = await prisma.$queryRaw<{ key: string }[]>(Prisma.sql`
        WITH candidate(key) AS (VALUES ${values})
        SELECT key
        FROM candidate
        WHERE EXISTS (
          SELECT 1
          FROM user_private_message
          WHERE is_deleted = false
            AND (
              image_url LIKE '%' || candidate.key || '%'
              OR image_group::text LIKE '%' || candidate.key || '%'
              OR reply_image::text LIKE '%' || candidate.key || '%'
            )
        )
      `)

      return new Set(rows.map((row) => row.key))
    },
    deleteObject: (key) => deleteFileFromS3(key),
    now: () => new Date(),
    close: async () => {
      await prisma.$disconnect()
      await pool.end().catch(() => undefined)
    }
  }
}

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) => {
  let index = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const current = index
        index += 1
        if (current >= items.length) {
          return
        }
        await worker(items[current])
      }
    }
  )

  await Promise.all(workers)
}

export const runConversationImageCleanup = async (
  options: ConversationImageCleanupOptions,
  dependencies: ConversationImageCleanupDependencies
): Promise<ConversationImageCleanupRunResult> => {
  const result: ConversationImageCleanupRunResult = {
    scanned: 0,
    eligible: 0,
    deleted: 0,
    referenced: 0,
    tooNew: 0,
    invalidKey: 0,
    failed: 0,
    candidates: [],
    failures: []
  }
  const cutoffMs =
    dependencies.now().getTime() - options.olderThanHours * 60 * 60 * 1000
  let continuationToken: string | undefined

  do {
    const remaining =
      options.limit === undefined
        ? options.batchSize
        : options.limit - result.scanned
    if (remaining <= 0) break

    const page = await dependencies.listObjects({
      prefix: options.prefix,
      continuationToken,
      maxKeys: Math.min(options.batchSize, remaining)
    })
    continuationToken = page.nextContinuationToken

    const objects = page.objects.slice(0, remaining)
    if (objects.length === 0) break

    result.scanned += objects.length

    const oldCanonicalObjects: ConversationImageCleanupObject[] = []
    for (const object of objects) {
      if (!isCanonicalConversationImageKey(object.key)) {
        result.invalidKey += 1
        continue
      }

      if (!object.lastModified || object.lastModified.getTime() > cutoffMs) {
        result.tooNew += 1
        continue
      }

      oldCanonicalObjects.push(object)
    }

    const referencedKeys = await dependencies.findReferencedKeys(
      oldCanonicalObjects.map((object) => object.key)
    )
    const candidates = oldCanonicalObjects
      .filter((object) => {
        if (referencedKeys.has(object.key)) {
          result.referenced += 1
          return false
        }
        return true
      })
      .map((object) => object.key)

    result.eligible += candidates.length
    result.candidates.push(...candidates)

    if (options.apply && candidates.length > 0) {
      await runWithConcurrency(candidates, options.concurrency, async (key) => {
        try {
          await dependencies.deleteObject(key)
          result.deleted += 1
          if (options.verbose) {
            console.log(`Deleted conversation image: ${key}`)
          }
        } catch (error) {
          result.failed += 1
          result.failures.push({ key, reason: getErrorMessage(error) })
        }

        await sleep(options.delayMs)
      })
    }
  } while (continuationToken)

  return result
}

export const printConversationImageCleanupSummary = (
  options: ConversationImageCleanupOptions,
  result: ConversationImageCleanupRunResult
) => {
  const mode = options.apply ? 'Apply' : 'Dry run'
  console.log(
    `${mode} complete. scanned=${result.scanned}, eligible=${result.eligible}, deleted=${result.deleted}, referenced=${result.referenced}, tooNew=${result.tooNew}, invalidKey=${result.invalidKey}, failed=${result.failed}`
  )

  if (!options.apply && result.candidates.length > 0) {
    console.log('Candidates:')
    for (const key of result.candidates) {
      console.log(`  ${key}`)
    }
  }

  if (result.failures.length > 0) {
    console.log('Failures:')
    for (const failure of result.failures) {
      console.log(`  ${failure.key}: ${failure.reason}`)
    }
  }
}

const shouldRunCli = () => {
  const entry = process.argv[1]
  return Boolean(
    entry && import.meta.url === pathToFileURL(resolve(entry)).href
  )
}

if (shouldRunCli()) {
  const options = buildConversationImageCleanupOptions()
  let dependencies:
    | (ConversationImageCleanupDependencies & { close: () => Promise<void> })
    | undefined

  createConversationImageCleanupDependencies()
    .then(async (createdDependencies) => {
      dependencies = createdDependencies
      if (!options.apply) {
        console.log(
          `Running conversation image cleanup in dry-run mode with limit=${options.limit ?? 'all'}, olderThanHours=${options.olderThanHours}.`
        )
      } else {
        console.log(
          `Running conversation image cleanup apply mode with limit=${options.limit ?? 'all'}, batch=${options.batchSize}, concurrency=${options.concurrency}, delay=${options.delayMs}ms, olderThanHours=${options.olderThanHours}.`
        )
      }

      const result = await runConversationImageCleanup(options, dependencies)
      printConversationImageCleanupSummary(options, result)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await dependencies?.close()
    })
}
