export const getDatabasePoolMax = (
  value = process.env.KUN_DATABASE_POOL_MAX
) => {
  if (value === undefined || value === '') return 30
  const parsed = Number(value)
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > 1000
  ) {
    throw new Error('KUN_DATABASE_POOL_MAX must be an integer from 1 to 1000')
  }
  return parsed
}
