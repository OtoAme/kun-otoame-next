import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const pools: Array<{ options: unknown; end: ReturnType<typeof vi.fn> }> = []
  const clients: Array<{
    options: unknown
    $disconnect: ReturnType<typeof vi.fn>
  }> = []

  const Pool = vi.fn(function (options: unknown) {
    const pool = {
      options,
      end: vi.fn().mockResolvedValue(undefined)
    }
    pools.push(pool)
    return pool
  })

  const PrismaPg = vi.fn(function (pool: unknown, options: unknown) {
    return { pool, options }
  })

  const PrismaClient = vi.fn(function (options: unknown) {
    const client = {
      options,
      $disconnect: vi.fn().mockResolvedValue(undefined)
    }
    clients.push(client)
    return client
  })

  return { pools, clients, Pool, PrismaPg, PrismaClient }
})

vi.mock('dotenv/config', () => ({}))
vi.mock('pg', () => ({
  default: { Pool: mocks.Pool },
  Pool: mocks.Pool
}))
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: mocks.PrismaPg }))
vi.mock('@prisma/client', () => ({ PrismaClient: mocks.PrismaClient }))

const RUNTIME_KEY = '__kunOtoamePrismaRuntime'

const globalRecord = () => globalThis as Record<string, unknown>

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.pools.length = 0
  mocks.clients.length = 0
  delete globalRecord()[RUNTIME_KEY]
  vi.stubEnv('KUN_DATABASE_URL', 'postgresql://mock.local/test')
})

afterEach(() => {
  delete globalRecord()[RUNTIME_KEY]
  vi.unstubAllEnvs()
})

describe('Prisma adapter runtime lifecycle', () => {
  it('reuses one pool and client across development module reloads', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const first = await import('~/prisma/index')
    vi.resetModules()
    const second = await import('~/prisma/index')

    expect(mocks.Pool).toHaveBeenCalledOnce()
    expect(mocks.PrismaPg).toHaveBeenCalledOnce()
    expect(mocks.PrismaClient).toHaveBeenCalledOnce()
    expect(second.prisma).toBe(first.prisma)
    expect(mocks.pools[0]?.options).toMatchObject({
      max: 30,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    })

    const adapterOptions = mocks.PrismaPg.mock.calls[0]?.[1] as {
      statementNameGenerator: (query: { sql: string }) => string
    }
    expect(adapterOptions.statementNameGenerator({ sql: 'select 1' })).toBe('s0')
    expect(adapterOptions.statementNameGenerator({ sql: 'select 1' })).toBe('s0')
    expect(adapterOptions.statementNameGenerator({ sql: 'select 2' })).toBe('s1')

    await first.disconnectPrismaAdapter()

    expect(mocks.clients[0]?.$disconnect).toHaveBeenCalledOnce()
    expect(mocks.pools[0]?.end).toHaveBeenCalledOnce()
    expect(globalRecord()[RUNTIME_KEY]).toBeUndefined()
  })

  it('keeps production runtime construction module-scoped', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const first = await import('~/prisma/index')
    vi.resetModules()
    const second = await import('~/prisma/index')

    expect(mocks.Pool).toHaveBeenCalledTimes(2)
    expect(mocks.PrismaClient).toHaveBeenCalledTimes(2)
    expect(first.prisma).not.toBe(second.prisma)
    expect(globalRecord()[RUNTIME_KEY]).toBeUndefined()

    await first.disconnectPrismaAdapter()
    await second.disconnectPrismaAdapter()

    expect(mocks.clients[0]?.$disconnect).toHaveBeenCalledOnce()
    expect(mocks.clients[1]?.$disconnect).toHaveBeenCalledOnce()
    expect(mocks.pools[0]?.end).toHaveBeenCalledOnce()
    expect(mocks.pools[1]?.end).toHaveBeenCalledOnce()
  })
})
