import { Prisma } from '@prisma/client'
import {
  COMPANY_IDENTITY_VALUE_MAX_LENGTH,
  isCompanyIdentityValueWithinLimit,
  normalizeCompanyValue
} from './normalize'

type TxClient = Prisma.TransactionClient

export type CompanyIdentityOrigin = 'authoritative' | 'legacy'
export type CompanyIdentityKind = 'name' | 'alias'

export interface CompanyIdentityProjectionSource {
  name: string
  aliases: string[]
  aliasOrigin?: CompanyIdentityOrigin
}

export interface CompanyIdentityProjectionInput {
  companyId: number
  aliasOrigin?: CompanyIdentityOrigin
}

export interface CompanyIdentityProjectionValue {
  kind: CompanyIdentityKind
  origin: CompanyIdentityOrigin
  value: string
  normalizedValue: string
}

export interface StoredCompanyIdentityProjectionValue {
  id: number
  kind: string
  origin: string
  value: string
  normalizedValue: string
  confirmedByUserId: number | null
}

export interface StoredCompanyIdentityProjection {
  normalizedName: string | null
  identities: StoredCompanyIdentityProjectionValue[]
}

export const buildCompanyIdentityProjection = (
  input: CompanyIdentityProjectionSource
) => {
  const name = input.name.trim()
  if (
    name.length > COMPANY_IDENTITY_VALUE_MAX_LENGTH ||
    !isCompanyIdentityValueWithinLimit(name)
  ) {
    throw new RangeError('Company name cannot fit the identity columns')
  }
  const normalizedName = normalizeCompanyValue(name)
  const aliases = new Map<string, string>()
  for (const rawAlias of input.aliases) {
    const value = rawAlias.trim()
    if (!value) continue
    if (
      value.length > COMPANY_IDENTITY_VALUE_MAX_LENGTH ||
      !isCompanyIdentityValueWithinLimit(value)
    ) {
      throw new RangeError('Company alias cannot fit the identity columns')
    }
    const normalizedValue = normalizeCompanyValue(value)
    if (!normalizedValue || aliases.has(normalizedValue)) continue
    aliases.set(normalizedValue, value)
  }

  const identities: CompanyIdentityProjectionValue[] = [
    {
      kind: 'name',
      origin: 'authoritative',
      value: name,
      normalizedValue: normalizedName
    },
    ...[...aliases.entries()].map(([normalizedValue, value]) => ({
      kind: 'alias' as const,
      origin: input.aliasOrigin ?? ('legacy' as const),
      value,
      normalizedValue
    }))
  ]

  return { normalizedName, identities }
}

export const planCompanyIdentityProjection = (
  input: CompanyIdentityProjectionSource,
  current: StoredCompanyIdentityProjection
) => {
  const projection = buildCompanyIdentityProjection(input)
  const desiredByKey = new Map(
    projection.identities.map((identity) => [
      `${identity.kind}\u0000${identity.normalizedValue}`,
      identity
    ])
  )
  const existingByKey = new Map(
    current.identities.map((identity) => [
      `${identity.kind}\u0000${identity.normalizedValue}`,
      identity
    ])
  )
  const obsoleteIds = current.identities
    .filter(
      (identity) =>
        (identity.kind === 'name' || identity.kind === 'alias') &&
        !desiredByKey.has(`${identity.kind}\u0000${identity.normalizedValue}`)
    )
    .map((identity) => identity.id)
  const toCreate: CompanyIdentityProjectionValue[] = []
  const toUpdate: Array<{
    id: number
    value: string
    makeAuthoritative: boolean
  }> = []

  for (const desired of projection.identities) {
    const existing = existingByKey.get(
      `${desired.kind}\u0000${desired.normalizedValue}`
    )
    if (!existing) {
      toCreate.push(desired)
      continue
    }

    const makeAuthoritative =
      (desired.kind === 'name' &&
        (existing.origin !== 'authoritative' ||
          existing.confirmedByUserId !== null)) ||
      (desired.kind === 'alias' &&
        desired.origin === 'authoritative' &&
        existing.origin !== 'authoritative')
    if (existing.value !== desired.value || makeAuthoritative) {
      toUpdate.push({
        id: existing.id,
        value: desired.value,
        makeAuthoritative
      })
    }
  }

  return {
    normalizedName: projection.normalizedName,
    normalizedNameChanged: current.normalizedName !== projection.normalizedName,
    obsoleteIds,
    toCreate,
    toUpdate
  }
}

/**
 * Keeps patch_company.alias as the display/search source of truth and updates
 * the normalized identity rows as its transaction-local derived projection.
 */
export const syncCompanyIdentityProjection = async (
  tx: TxClient,
  input: CompanyIdentityProjectionInput
) => {
  const locked = await tx.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM patch_company WHERE id = ${input.companyId} FOR UPDATE`
  )
  if (!locked.length) throw new Error(`Company #${input.companyId} not found`)

  const company = await tx.patch_company.findUnique({
    where: { id: input.companyId },
    select: {
      name: true,
      alias: true,
      normalized_name: true,
      name_identities: {
        select: {
          id: true,
          kind: true,
          origin: true,
          value: true,
          normalized_value: true,
          confirmed_by_user_id: true
        }
      }
    }
  })
  if (!company) throw new Error(`Company #${input.companyId} not found`)

  const plan = planCompanyIdentityProjection(
    {
      name: company.name,
      aliases: company.alias,
      aliasOrigin: input.aliasOrigin
    },
    {
      normalizedName: company.normalized_name,
      identities: company.name_identities.map((identity) => ({
        id: identity.id,
        kind: identity.kind,
        origin: identity.origin,
        value: identity.value,
        normalizedValue: identity.normalized_value,
        confirmedByUserId: identity.confirmed_by_user_id
      }))
    }
  )

  let normalizedNameUpdated = 0
  if (plan.normalizedNameChanged) {
    await tx.patch_company.update({
      where: { id: input.companyId },
      data: { normalized_name: plan.normalizedName }
    })
    normalizedNameUpdated = 1
  }

  const deleted = plan.obsoleteIds.length
    ? await tx.patch_company_name_identity.deleteMany({
        where: { id: { in: plan.obsoleteIds } }
      })
    : { count: 0 }

  const toCreate: Prisma.patch_company_name_identityCreateManyInput[] =
    plan.toCreate.map((identity) => ({
      company_id: input.companyId,
      kind: identity.kind,
      origin: identity.origin,
      value: identity.value,
      normalized_value: identity.normalizedValue,
      confirmed_by_user_id: null
    }))
  for (const update of plan.toUpdate) {
    await tx.patch_company_name_identity.update({
      where: { id: update.id },
      data: {
        value: update.value,
        ...(update.makeAuthoritative
          ? { origin: 'authoritative', confirmed_by_user_id: null }
          : {})
      }
    })
  }

  const created = toCreate.length
    ? await tx.patch_company_name_identity.createMany({
        data: toCreate,
        skipDuplicates: true
      })
    : { count: 0 }

  return {
    normalizedNameUpdated,
    created: created.count,
    updated: plan.toUpdate.length,
    deleted: deleted.count
  }
}
