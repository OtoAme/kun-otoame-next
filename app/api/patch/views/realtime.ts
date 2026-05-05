import { getPatchViewBufferCounts } from './buffer'

type PatchViewItem = {
  uniqueId: string
  view: number
}

export const withRealtimePatchViews = async <T extends PatchViewItem>(
  patches: T[]
) => {
  if (!patches.length) {
    return patches
  }

  try {
    const counts = await getPatchViewBufferCounts(
      patches.map((patch) => patch.uniqueId)
    )
    if (counts.size === 0) {
      return patches
    }

    return patches.map((patch) => {
      const bufferedCount = counts.get(patch.uniqueId) ?? 0
      return bufferedCount > 0
        ? { ...patch, view: patch.view + bufferedCount }
        : patch
    })
  } catch (error) {
    console.error('Failed to read realtime patch view counts:', error)
    return patches
  }
}

export const withRealtimePatchView = async <T extends PatchViewItem>(
  patch: T
) => {
  const [realtimePatch] = await withRealtimePatchViews([patch])
  return realtimePatch
}
