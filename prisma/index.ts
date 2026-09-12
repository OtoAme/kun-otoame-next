import 'dotenv/config'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const STATEMENT_CACHE_MAX = 1000

type PrismaRuntime = {
  pool: InstanceType<typeof pg.Pool>
  prisma: PrismaClient
}

const createPrismaRuntime = (): PrismaRuntime => {
  const connectionString = `${process.env.KUN_DATABASE_URL}`

  const pool = new pg.Pool({
    connectionString,
    max: 30,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  })

  // Keep statement names with the pool that owns them. Rebuilding this map on
  // a development hot reload would reuse a live pool with different names.
  const statementNames = new Map<string, string>()
  let statementCounter = 0

  const statementNameGenerator = (query: { sql: string }) => {
    const cached = statementNames.get(query.sql)
    if (cached !== undefined) return cached
    if (statementNames.size >= STATEMENT_CACHE_MAX) {
      const oldest = statementNames.keys().next().value
      if (oldest !== undefined) statementNames.delete(oldest)
    }
    const name = `s${(statementCounter++).toString(36)}`
    statementNames.set(query.sql, name)
    return name
  }

  const adapter = new PrismaPg(pool, { statementNameGenerator })
  const prisma = new PrismaClient({ adapter })
  return { pool, prisma }
}

type GlobalWithPrismaRuntime = typeof globalThis & {
  __kunOtoamePrismaRuntime?: PrismaRuntime
}

const globalForPrisma = globalThis as GlobalWithPrismaRuntime
const runtime =
  process.env.NODE_ENV === 'production'
    ? createPrismaRuntime()
    : (globalForPrisma.__kunOtoamePrismaRuntime ??= createPrismaRuntime())

const { pool, prisma } = runtime

/**
 * Close both Prisma and the externally owned PostgreSQL adapter pool.
 *
 * Only short-lived CLI/worker processes should call this. Long-running server
 * code shares the singleton and must leave its lifecycle to the process.
 */
const disconnectPrismaAdapter = async () => {
  try {
    await prisma.$disconnect()
  } finally {
    try {
      await pool.end()
    } finally {
      if (globalForPrisma.__kunOtoamePrismaRuntime === runtime) {
        delete globalForPrisma.__kunOtoamePrismaRuntime
      }
    }
  }
}

export { disconnectPrismaAdapter, prisma }
