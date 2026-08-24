import { prisma } from '~/prisma/index'

export type ExternalIdField =
  | 'bangumiId'
  | 'steamId'
  | 'vndbRelationId'
  | 'dlsiteCode'
/** Fields the database itself enforces, so a duplicate surfaces as P2002. */
export type UniqueExternalIdField = 'bangumiId' | 'vndbRelationId' | 'dlsiteCode'

type DuplicatePatch = {
  id?: number
  unique_id: string
  name?: string
}

const fieldLabels: Record<ExternalIdField, string> = {
  bangumiId: 'Bangumi ID',
  steamId: 'Steam ID',
  vndbRelationId: 'Release ID',
  dlsiteCode: 'DLSite Code'
}

/**
 * Table driven so a new unique column only needs one entry here: the column
 * name Prisma reports in P2002, and how the submitted value is normalized for
 * the lookup. Missing entries used to fall through to a 500.
 */
const uniqueExternalIdColumns: Record<
  UniqueExternalIdField,
  { column: string; normalize: (value: string) => string | number | null }
> = {
  bangumiId: { column: 'bangumi_id', normalize: parseNumericExternalId },
  vndbRelationId: {
    column: 'vndb_relation_id',
    normalize: (value) => value.trim().toLowerCase() || null
  },
  dlsiteCode: {
    column: 'dlsite_code',
    normalize: (value) => value.trim().toUpperCase() || null
  }
}

function parseNumericExternalId(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const numericValue = Number(trimmed)
  return Number.isSafeInteger(numericValue) ? numericValue : null
}

const excludeCurrentPatchWhere = (excludeId?: number) =>
  excludeId ? { id: { not: excludeId } } : {}

export const findPatchByExternalId = async (
  field: ExternalIdField,
  value?: string,
  excludeId?: number
): Promise<DuplicatePatch | null> => {
  const select = { unique_id: true, name: true }
  const excludeCurrentPatch = excludeCurrentPatchWhere(excludeId)

  if (field === 'steamId') {
    const numericValue = parseNumericExternalId(value)
    if (numericValue === null) {
      return null
    }
    return prisma.patch.findFirst({
      where: { steam_id: numericValue, ...excludeCurrentPatch },
      select
    })
  }

  const normalized = uniqueExternalIdColumns[field].normalize(value ?? '')
  if (normalized === null) {
    return null
  }

  return prisma.patch.findFirst({
    where: {
      [uniqueExternalIdColumns[field].column]: normalized,
      ...excludeCurrentPatch
    },
    select
  })
}

export const findFirstUniqueExternalIdDuplicate = async (
  input: Partial<Record<UniqueExternalIdField, string>>,
  excludeId?: number
) => {
  for (const field of Object.keys(
    uniqueExternalIdColumns
  ) as UniqueExternalIdField[]) {
    const patch = await findPatchByExternalId(field, input[field], excludeId)
    if (patch) {
      return { field, patch }
    }
  }

  return null
}

export const formatUniqueExternalIdDuplicateMessage = (
  field: UniqueExternalIdField,
  uniqueId: string
) => `${fieldLabels[field]} 与游戏 ID 为 ${uniqueId} 的游戏重复`

const getP2002TargetField = (error: unknown): UniqueExternalIdField | null => {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const code = (error as { code?: unknown }).code
  if (code !== 'P2002') {
    return null
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target
  const targetFields = Array.isArray(target)
    ? target
    : typeof target === 'string'
      ? [target]
      : []

  for (const [field, { column }] of Object.entries(uniqueExternalIdColumns) as [
    UniqueExternalIdField,
    { column: string }
  ][]) {
    if (targetFields.includes(column)) {
      return field
    }
  }

  return null
}

export const resolveUniqueExternalIdConstraintMessage = async (
  error: unknown,
  input: Partial<Record<UniqueExternalIdField, string>>,
  excludeId?: number
) => {
  const field = getP2002TargetField(error)
  if (!field) {
    return null
  }

  const patch = await findPatchByExternalId(field, input[field], excludeId)

  if (patch) {
    return formatUniqueExternalIdDuplicateMessage(field, patch.unique_id)
  }

  return `${fieldLabels[field]} 已存在，请检查是否重复发布`
}
