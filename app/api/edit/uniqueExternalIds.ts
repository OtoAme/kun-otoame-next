import { prisma } from '~/prisma/index'

export type ExternalIdField = 'bangumiId' | 'steamId'
export type UniqueExternalIdField = 'bangumiId'

type DuplicatePatch = {
  id?: number
  unique_id: string
  name?: string
}

const fieldLabels: Record<ExternalIdField, string> = {
  bangumiId: 'Bangumi ID',
  steamId: 'Steam ID'
}

const parseNumericExternalId = (value?: string) => {
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
  const numericValue = parseNumericExternalId(value)
  if (numericValue === null) {
    return null
  }

  const select = { unique_id: true, name: true }
  const excludeCurrentPatch = excludeCurrentPatchWhere(excludeId)

  if (field === 'bangumiId') {
    return prisma.patch.findFirst({
      where: { bangumi_id: numericValue, ...excludeCurrentPatch },
      select
    })
  }

  return prisma.patch.findFirst({
    where: { steam_id: numericValue, ...excludeCurrentPatch },
    select
  })
}

export const findFirstUniqueExternalIdDuplicate = async (
  input: Partial<Record<UniqueExternalIdField, string>>,
  excludeId?: number
) => {
  for (const field of ['bangumiId'] as const) {
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

  if (targetFields.includes('bangumi_id')) {
    return 'bangumiId'
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
