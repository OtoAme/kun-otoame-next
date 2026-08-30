import { disconnectPrismaAdapter, prisma } from '~/prisma/index'
import {
  applyFrozenCompanyCleanup,
  dryRunFrozenCompanyCleanup,
  loadFrozenCompanyCleanupPlan
} from './companyCleanupFrozenApply'

type CliMode = 'inventory' | 'plan' | 'dry' | 'apply' | 'cache'

const allowedArguments: Record<CliMode, Set<string>> = {
  inventory: new Set(['out']),
  plan: new Set(['inventory', 'decisions', 'out']),
  dry: new Set(['plan']),
  apply: new Set([
    'apply',
    'plan',
    'confirm-sha256',
    'lock-timeout-ms',
    'statement-timeout-ms'
  ]),
  cache: new Set(['plan'])
}

export const parseFrozenCompanyCleanupCliArguments = (
  mode: CliMode,
  args: string[]
) => {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--'))
      throw new Error(`Unexpected argument: ${argument}`)
    const equals = argument.indexOf('=')
    const key = argument.slice(2, equals === -1 ? undefined : equals)
    if (!allowedArguments[mode].has(key)) {
      throw new Error(`Unknown argument for ${mode}: --${key}`)
    }
    if (values.has(key)) throw new Error(`Duplicate argument: --${key}`)
    if (equals !== -1) {
      if (key === 'apply') throw new Error('--apply does not accept a value')
      const value = argument.slice(equals + 1)
      if (!value) throw new Error(`Missing value for --${key}`)
      values.set(key, value)
      continue
    }
    const next = args[index + 1]
    if (!next || next.startsWith('--')) {
      if (key !== 'apply') throw new Error(`Missing value for --${key}`)
      values.set(key, 'true')
      continue
    }
    if (key === 'apply') throw new Error('--apply does not accept a value')
    values.set(key, next)
    index += 1
  }
  return values
}

const required = (values: Map<string, string>, key: string) => {
  const value = values.get(key)?.trim()
  if (!value) throw new Error(`Missing required --${key}`)
  return value
}

const optionalInteger = (values: Map<string, string>, key: string) => {
  const value = values.get(key)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`--${key} must be an integer`)
  return parsed
}

export const runFrozenCompanyCleanupCli = async (
  mode: CliMode,
  args = process.argv.slice(2)
) => {
  const values = parseFrozenCompanyCleanupCliArguments(mode, args)
  if (mode === 'inventory') {
    const { writeCompanyInventory } = await import(
      './companyCleanupFrozenPlanner'
    )
    const outputPath = required(values, 'out')
    const digest = await writeCompanyInventory(prisma, outputPath)
    console.log(`Company inventory written: ${outputPath}`)
    console.log(`SHA-256: ${digest}`)
    return
  }
  if (mode === 'plan') {
    const { generateFrozenCompanyCleanupPlan } = await import(
      './companyCleanupFrozenPlanner'
    )
    const result = await generateFrozenCompanyCleanupPlan({
      db: prisma,
      inventoryPath: required(values, 'inventory'),
      decisionsPath: required(values, 'decisions'),
      outputPath: required(values, 'out')
    })
    console.log('Frozen company cleanup plan written.')
    console.log(`SHA-256: ${result.planDigest}`)
    console.log(
      `Actions: ${result.plan.limits.actions}; relations: ${result.plan.limits.relations}; blockers: ${result.plan.blockers.length}; warnings: ${result.plan.warnings.length}`
    )
    if (result.plan.blockers.length) process.exitCode = 2
    return
  }

  const planPath = required(values, 'plan')
  const loaded = await loadFrozenCompanyCleanupPlan(planPath)
  if (mode === 'dry') {
    const result = await dryRunFrozenCompanyCleanup(prisma, loaded.plan)
    console.log(
      `Frozen company cleanup dry-run: ${result.status}; actions=${result.actions}; relations=${result.relations}; warnings=${result.warnings.length}`
    )
    return
  }
  if (mode === 'apply') {
    const receipt = await applyFrozenCompanyCleanup({
      db: prisma,
      plan: loaded.plan,
      planSha256: loaded.digest,
      planPath,
      confirmSha256: required(values, 'confirm-sha256'),
      lockTimeoutMs: optionalInteger(values, 'lock-timeout-ms'),
      statementTimeoutMs: optionalInteger(values, 'statement-timeout-ms')
    })
    console.log(
      `Frozen company cleanup database status: ${receipt.databaseStatus}; cache=${receipt.cache.status}`
    )
    return
  }
  const { runFrozenCompanyCleanupCache } = await import(
    './companyCleanupFrozenCache'
  )
  const receipt = await runFrozenCompanyCleanupCache({
    db: prisma,
    plan: loaded.plan,
    planPath,
    planSha256: loaded.digest
  })
  console.log(
    `Frozen company cleanup cache status: ${receipt.cache.status}; ISR=${receipt.cache.isr}`
  )
}

export const finishFrozenCompanyCleanupCli = async (mode: CliMode) => {
  try {
    await runFrozenCompanyCleanupCli(mode)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    if (mode === 'cache') {
      const { disconnectCompanyCleanupCacheRedis } = await import(
        './companyCleanupFrozenCache'
      )
      await disconnectCompanyCleanupCacheRedis()
    }
    await disconnectPrismaAdapter()
  }
}
