import type { MirrorCard, MirrorLink } from './decide'

export const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (
    typeof value === 'string' &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value)
  }
  return null
}

export const asDate = (value: unknown) => {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export const asText = (value: unknown) =>
  typeof value === 'string' ? value : ''

export const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

export const likePattern = (search: string) =>
  `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

export const rowLink = (row: Record<string, unknown>): MirrorLink | null => {
  const id = asNumber(row.id)
  const resourceId = asNumber(row.resource_id)
  if (id === null || resourceId === null) return null
  return {
    id,
    resourceId,
    storage: asText(row.storage),
    content: asText(row.content),
    size: asText(row.size),
    version: asNumber(row.version) ?? 1,
    sortOrder: asNumber(row.sort_order) ?? 0,
    code: asText(row.code),
    password: asText(row.password),
    fileHash: asText(row.hash),
    attachedAt: asDate(row.attached_at),
    contentChangedAt: asDate(row.content_changed_at)
  }
}

export const rowCard = (
  row: Record<string, unknown>,
  links: MirrorLink[]
): MirrorCard | null => {
  const id = asNumber(row.id)
  const patchId = asNumber(row.patch_id)
  const userId = asNumber(row.user_id)
  const created = asDate(row.created)
  const updated = asDate(row.updated)
  if (
    id === null ||
    patchId === null ||
    userId === null ||
    !created ||
    !updated
  ) {
    return null
  }
  return {
    id,
    patchId,
    patchUniqueId: asText(row.patch_unique_id),
    patchName: asText(row.patch_name),
    patchStatus: asNumber(row.patch_status) ?? 0,
    section: asText(row.section),
    name: asText(row.name),
    note: asText(row.note),
    type: asStringArray(row.type),
    language: asStringArray(row.language),
    platform: asStringArray(row.platform),
    status: asNumber(row.status) ?? 0,
    download: asNumber(row.download) ?? 0,
    userId,
    publisherName: asText(row.publisher_name),
    role: asNumber(row.role) ?? 0,
    publisherLeftAt: asDate(row.publisher_left_at),
    created,
    updated,
    links: links.filter((link) => link.resourceId === id)
  }
}

export const recordsOf = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object'
      )
    : []
