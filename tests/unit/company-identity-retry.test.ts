import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  COMPANY_IDENTITY_TRANSACTION_MAX_ATTEMPTS,
  isCompanyIdentityConstraintError,
  isCompanyIdentityResolverEnabled,
  runWithCompanyIdentityConstraintRetry
} from '~/app/api/company/identity/retry'

const p2002 = (target: string[] | string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target }
  })

afterEach(() => {
  delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
})

describe('company identity transaction retry', () => {
  it.each([
    [['normalized_name']],
    [['source', 'external_id']],
    ['patch_company_normalized_name_key'],
    ['patch_company_external_id_source_external_id_key'],
    ['public.patch_company_normalized_name_key']
  ])('recognizes only a target company identity constraint: %j', (target) => {
    expect(isCompanyIdentityConstraintError(p2002(target as never))).toBe(true)
  })

  it('restarts from the owning operation after an identity conflict', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(p2002(['normalized_name']))
      .mockResolvedValueOnce('winner')

    await expect(
      runWithCompanyIdentityConstraintRetry(operation)
    ).resolves.toBe('winner')
    expect(operation).toHaveBeenNthCalledWith(1, 1)
    expect(operation).toHaveBeenNthCalledWith(2, 2)
  })

  it('does not retry unrelated P2002 errors', async () => {
    const operation = vi.fn().mockRejectedValue(p2002(['unique_id']))

    await expect(
      runWithCompanyIdentityConstraintRetry(operation)
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(operation).toHaveBeenCalledOnce()
  })

  it('stops after the fixed attempt limit', async () => {
    const operation = vi.fn().mockRejectedValue(p2002(['normalized_name']))

    await expect(
      runWithCompanyIdentityConstraintRetry(operation)
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(operation).toHaveBeenCalledTimes(
      COMPANY_IDENTITY_TRANSACTION_MAX_ATTEMPTS
    )
  })
})

describe('company identity resolver feature flag', () => {
  it('is off by default and accepts only the explicit server value true', () => {
    expect(isCompanyIdentityResolverEnabled()).toBe(false)
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = '1'
    expect(isCompanyIdentityResolverEnabled()).toBe(false)
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = 'true'
    expect(isCompanyIdentityResolverEnabled()).toBe(true)
  })
})
