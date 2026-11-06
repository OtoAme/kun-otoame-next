import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { processResourceFileCleanup } from '~/lib/resourceFileCleanup'

/**
 * Formal replay for patch_resource_file_cleanup.
 *
 * The connection string comes from KUN_DATABASE_URL. When this file is invoked
 * directly it loads the repo dotenv the same way other maintenance commands do.
 * The command line accepts only non-secret selectors: --confirm-database, and
 * optionally --limit and --ids. The database name, including a production name,
 * is accepted when it exactly matches --confirm-database. Host, port, and the
 * database name are the only connection facts printed.
 */

export type ReplayArguments = {
  confirmDatabase: string
  limit?: number
  ids?: number[]
}

const integerList = (value: string) => {
  if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(value)) return null
  const ids = value.split(',').map((item) => Number(item))
  if (ids.some((id) => !Number.isSafeInteger(id))) return null
  return ids
}

export const parseReplayArguments = (
  argv: readonly string[]
): ReplayArguments | { error: string } => {
  let confirmDatabase: string | undefined
  let limit: number | undefined
  let ids: number[] | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--database-url') {
      return { error: 'connection string is not accepted on the command line' }
    }
    if (arg === '--confirm-database' || arg === '--limit' || arg === '--ids') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        return { error: `${arg} requires a value` }
      }
      index += 1
      if (arg === '--confirm-database') {
        if (confirmDatabase !== undefined) {
          return { error: '--confirm-database was provided twice' }
        }
        confirmDatabase = value
        continue
      }
      if (arg === '--limit') {
        if (limit !== undefined) return { error: '--limit was provided twice' }
        if (!/^[1-9]\d*$/.test(value)) {
          return { error: 'limit must be an integer from 1 to 200' }
        }
        const parsed = Number(value)
        if (parsed < 1 || parsed > 200) {
          return { error: 'limit must be an integer from 1 to 200' }
        }
        limit = parsed
        continue
      }
      if (ids !== undefined) return { error: '--ids was provided twice' }
      const parsed = integerList(value)
      if (!parsed) return { error: 'ids must be positive integers' }
      ids = parsed
      continue
    }
    return { error: 'unrecognized replay argument' }
  }
  if (!confirmDatabase) return { error: 'confirm-database is required' }
  return { confirmDatabase, ...(limit === undefined ? {} : { limit }), ...(ids ? { ids } : {}) }
}

export const confirmReplayDatabase = (
  databaseUrl: string | undefined,
  confirmDatabase: string
): { host: string; port: string; databaseName: string; databaseUrl: string } | { error: string } => {
  if (!databaseUrl) return { error: 'KUN_DATABASE_URL is required' }
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    return { error: 'KUN_DATABASE_URL is not a postgresql url' }
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return { error: 'KUN_DATABASE_URL must use postgresql' }
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!parsed.hostname || !databaseName || databaseName !== confirmDatabase) {
    return { error: 'confirm-database must exactly match the configured database name' }
  }
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    databaseName,
    databaseUrl
  }
}

const main = async () => {
  const parsed = parseReplayArguments(process.argv.slice(2))
  if ('error' in parsed) {
    console.error(parsed.error)
    process.exitCode = 2
    return
  }
  const { config } = await import('dotenv')
  config()
  const confirmed = confirmReplayDatabase(process.env.KUN_DATABASE_URL, parsed.confirmDatabase)
  if ('error' in confirmed) {
    console.error(confirmed.error)
    process.exitCode = 2
    return
  }

  console.log(
    `resource file cleanup replay target host=${confirmed.host} port=${confirmed.port} database=${confirmed.databaseName}`
  )
  const pool = new pg.Pool({
    connectionString: confirmed.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000
  })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const { deleteFileFromS3 } = await import('~/lib/s3')
    const report = await processResourceFileCleanup(prisma, {
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      ...(parsed.ids ? { ids: parsed.ids } : {}),
      deleteObject: async (objectKey) => {
        await deleteFileFromS3(objectKey)
        return 'deleted'
      },
      log: (event) => {
        console.log(
          `cleanup id=${event.cleanupId} resource=${event.resourceId} status=${event.status} failure=${event.failureCategory ?? ''}`
        )
      }
    })
    console.log(
      `examined=${report.examined} completed=${report.completed} cancelled=${report.cancelled} failed=${report.failed}`
    )
    if (report.failed > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  main().catch(() => {
    console.error('resource file cleanup replay failed')
    process.exitCode = 1
  })
}
