export const getStaticGenerationLimit = (
  value: string | undefined,
  fallback: number
) => {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return Math.floor(parsed)
}

export const STATIC_TAG_PREGEN_LIMIT = getStaticGenerationLimit(
  process.env.KUN_STATIC_TAG_PREGEN_LIMIT,
  50
)

export const STATIC_COMPANY_PREGEN_LIMIT = getStaticGenerationLimit(
  process.env.KUN_STATIC_COMPANY_PREGEN_LIMIT,
  50
)
