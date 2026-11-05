const UNIQUE_ID = /^[A-Za-z0-9]{8}$/

export type CacheRefreshRequest = {
  uniqueIds: string[]
  authorIds: number[]
}

const authorIdOk = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0

/**
 * 只使用预览或结果里已经有的页面标识和作者 id。
 * 缺页面标识时不猜测，也不补一个作者。
 */
export const cacheRefreshBody = (input: {
  patchUniqueId: string
  authorId?: number | null
  authorIds?: readonly (number | null | undefined)[]
}): CacheRefreshRequest | null => {
  if (!UNIQUE_ID.test(input.patchUniqueId)) return null
  const raw =
    input.authorIds ?? (input.authorId == null ? [] : [input.authorId])
  const authorIds: number[] = []
  for (const id of raw) {
    if (!authorIdOk(id) || authorIds.includes(id)) continue
    authorIds.push(id)
    if (authorIds.length === 40) break
  }
  return { uniqueIds: [input.patchUniqueId], authorIds }
}
