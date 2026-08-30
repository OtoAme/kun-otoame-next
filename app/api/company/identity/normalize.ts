export const COMPANY_IDENTITY_VALUE_MAX_LENGTH = 107

/** Shared by online writes, the resolver and every identity maintenance tool. */
export const normalizeCompanyValue = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

export const isCompanyIdentityValueWithinLimit = (value: string) =>
  normalizeCompanyValue(value).length <= COMPANY_IDENTITY_VALUE_MAX_LENGTH
