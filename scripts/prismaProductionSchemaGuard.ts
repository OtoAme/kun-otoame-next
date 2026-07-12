export const KNOWN_RELEASED_PATTERN_INDEX_DIFF = `-- DropIndex
DROP INDEX "patch_released_idx";

-- CreateIndex
CREATE INDEX "patch_released_idx" ON "patch"("released" text_pattern_ops);`

export type PrismaDiffResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type PrismaDiffClassification =
  | 'clean'
  | 'known-released-pattern-index'
  | 'unexpected'

export type ReleasedPatternIndexMetadata = {
  schema_name: string
  table_name: string
  index_name: string
  column_name: string
  access_method: string
  operator_class: string
  key_attribute_count: number
  total_attribute_count: number
  is_unique: boolean
  is_primary: boolean
  is_valid: boolean
  is_ready: boolean
  is_live: boolean
  has_no_predicate: boolean
  has_no_expression: boolean
}

type GuardDependencies = {
  runDiff: () => Promise<PrismaDiffResult>
  loadIndexMetadata: () => Promise<ReleasedPatternIndexMetadata[]>
  log: (message: string) => void
}

const normalizeDiff = (value: string) => value.replaceAll('\r\n', '\n').trim()

export const classifyPrismaDiff = (
  result: Pick<PrismaDiffResult, 'exitCode' | 'stdout'>
): PrismaDiffClassification => {
  if (result.exitCode === 0) return 'clean'
  if (
    result.exitCode === 2 &&
    normalizeDiff(result.stdout) === KNOWN_RELEASED_PATTERN_INDEX_DIFF
  ) {
    return 'known-released-pattern-index'
  }
  return 'unexpected'
}

export const isExpectedReleasedPatternIndex = (
  row: ReleasedPatternIndexMetadata
) =>
  row.schema_name === 'public' &&
  row.table_name === 'patch' &&
  row.index_name === 'patch_released_idx' &&
  row.column_name === 'released' &&
  row.access_method === 'btree' &&
  row.operator_class === 'text_pattern_ops' &&
  row.key_attribute_count === 1 &&
  row.total_attribute_count === 1 &&
  !row.is_unique &&
  !row.is_primary &&
  row.is_valid &&
  row.is_ready &&
  row.is_live &&
  row.has_no_predicate &&
  row.has_no_expression

export const runPrismaProductionSchemaGuard = async ({
  runDiff,
  loadIndexMetadata,
  log
}: GuardDependencies): Promise<
  Exclude<PrismaDiffClassification, 'unexpected'>
> => {
  const result = await runDiff()
  const classification = classifyPrismaDiff(result)

  if (classification === 'clean') {
    log('Prisma production schema guard: no drift detected.')
    return classification
  }

  if (classification === 'unexpected') {
    const suffix = result.exitCode === 2 ? `\n${result.stdout.trim()}` : ''
    throw new Error(
      `Unexpected Prisma schema drift or diff failure (exit ${String(result.exitCode)}).${suffix}`
    )
  }

  const rows = await loadIndexMetadata()
  if (rows.length !== 1 || !isExpectedReleasedPatternIndex(rows[0])) {
    throw new Error(
      'Known Prisma operator-class drift was reported, but patch_released_idx catalog validation failed.'
    )
  }

  log(
    'Prisma production schema guard: accepted the verified patch_released_idx operator-class introspection exception.'
  )
  return classification
}
