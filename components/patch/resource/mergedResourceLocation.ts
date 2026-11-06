import type { OfficialMirrorResolveHit } from '~/types/api/officialMirror'

export type ResolvedResourceLocation = OfficialMirrorResolveHit

const UNIQUE_ID = /^[A-Za-z0-9]{8}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** GET /patch/resource/resolve 的命中。null、缺字段或不可作为路径的标识都停止跳转。 */
export const parseResolvedResource = (
  body: unknown
): ResolvedResourceLocation | null => {
  if (!isRecord(body)) return null
  const patchUniqueId =
    typeof body.patchUniqueId === 'string' ? body.patchUniqueId : ''
  const section = body.section
  const resourceId = body.resourceId
  const patchId = body.patchId
  if (!UNIQUE_ID.test(patchUniqueId)) return null
  if (section !== 'galgame' && section !== 'patch') return null
  if (typeof resourceId !== 'number' || !Number.isSafeInteger(resourceId)) {
    return null
  }
  if (resourceId <= 0) return null
  if (typeof patchId !== 'number' || !Number.isSafeInteger(patchId)) {
    return null
  }
  if (patchId <= 0) return null
  return { patchId, patchUniqueId, section, resourceId }
}

export const resolvedResourceHref = (location: ResolvedResourceLocation) => {
  const params = new URLSearchParams({
    tab: 'resources',
    resourceSection: location.section,
    resourceId: String(location.resourceId)
  })
  return `/${location.patchUniqueId}?${params.toString()}`
}

export const isResourceGoneMessage = (message: string) =>
  /资源不存在|资源已不存在|已合并或不存在|内容不存在或已不可用/.test(message)

/**
 * 一次解析的结果能否替换地址。
 * 代数不一致的是迟到响应。空结果、指向已尝试过的目标、或与当前地址相同，都停止。
 */
export const decideResolvedRedirect = (input: {
  location: ResolvedResourceLocation | null
  requestGeneration: number
  currentGeneration: number
  attemptedDestinationIds: ReadonlySet<number>
  currentHref: string
}): { href: string; destinationId: number } | null => {
  if (input.requestGeneration !== input.currentGeneration) return null
  if (!input.location) return null
  if (input.attemptedDestinationIds.has(input.location.resourceId)) return null
  const href = resolvedResourceHref(input.location)
  if (href === input.currentHref) return null
  return { href, destinationId: input.location.resourceId }
}
