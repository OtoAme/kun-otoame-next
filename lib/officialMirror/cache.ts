import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { safeRevalidatePath } from '~/app/api/patch/revalidate'

export const refreshOfficialMirrorPresentation = async (input: {
  uniqueIds: readonly string[]
  authorIds: readonly number[]
}) => {
  const uniqueIds = [...new Set(input.uniqueIds.filter(Boolean))]
  const authorIds = [...new Set(input.authorIds.filter((id) => id > 0))]
  await Promise.all(
    uniqueIds.map((uniqueId) => invalidatePatchContentCache(uniqueId))
  )
  await invalidatePatchListCaches()
  for (const authorId of authorIds) {
    safeRevalidatePath(`/user/${authorId}`, 'page')
    safeRevalidatePath(`/user/${authorId}/resource`, 'page')
  }
}

export const refreshAfterCommit = async (
  operation: string,
  input: { uniqueIds: readonly string[]; authorIds: readonly number[] }
) => {
  try {
    await refreshOfficialMirrorPresentation(input)
    return true
  } catch (error) {
    console.error('[official-mirror] cache refresh failed', {
      operation,
      uniqueIds: input.uniqueIds,
      authorIds: input.authorIds,
      error: error instanceof Error ? error.message : 'unknown'
    })
    return false
  }
}
