import { Prisma } from '@prisma/client'

export const COMPANY_IDENTITY_TRANSACTION_MAX_ATTEMPTS = 3

const normalizedNameTargets = new Set([
  'normalized_name',
  'patch_company_normalized_name_key'
])
const externalIdTargets = new Set([
  'source,external_id',
  'external_id,source',
  'patch_company_external_id_source_external_id_key'
])

const normalizedTarget = (target: unknown) => {
  if (Array.isArray(target)) {
    return target.map(String).join(',')
  }
  return String(target ?? '')
    .replace(/["'`]/g, '')
    .trim()
}

export const isCompanyIdentityConstraintError = (error: unknown) => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false
  }

  const target = normalizedTarget(error.meta?.target)
  const unqualifiedTarget = target.split('.').at(-1) ?? target
  return (
    normalizedNameTargets.has(target) ||
    normalizedNameTargets.has(unqualifiedTarget) ||
    externalIdTargets.has(target) ||
    externalIdTargets.has(unqualifiedTarget)
  )
}

/**
 * A PostgreSQL uniqueness error aborts its transaction. Retry only from the
 * owner of that transaction; never query again in the failed callback.
 */
export const runWithCompanyIdentityConstraintRetry = async <T>(
  operation: (attempt: number) => Promise<T>
): Promise<T> => {
  for (
    let attempt = 1;
    attempt <= COMPANY_IDENTITY_TRANSACTION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (
        !isCompanyIdentityConstraintError(error) ||
        attempt === COMPANY_IDENTITY_TRANSACTION_MAX_ATTEMPTS
      ) {
        throw error
      }
    }
  }

  throw new Error('Unreachable company identity retry state')
}

export const isCompanyIdentityResolverEnabled = () =>
  process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED === 'true'
