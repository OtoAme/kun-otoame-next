import { getRealtimePatchStats } from './buffer'

type PatchStatsItem = {
  uniqueId: string
  view: number
  download?: number
}

export const withRealtimePatchViews = async <T extends PatchStatsItem>(
  patches: T[]
) => {
  if (!patches.length) {
    return patches
  }

  try {
    const stats = await getRealtimePatchStats(
      patches.map((patch) => patch.uniqueId)
    )

    return patches.map((patch) => {
      const view = stats.view.get(patch.uniqueId) ?? patch.view
      const download =
        typeof patch.download === 'number'
          ? (stats.download.get(patch.uniqueId) ?? patch.download)
          : patch.download

      return { ...patch, view, download }
    })
  } catch (error) {
    console.error('Failed to read realtime patch stats:', error)
    return patches
  }
}

export const withRealtimePatchView = async <T extends PatchStatsItem>(
  patch: T
) => {
  const [realtimePatch] = await withRealtimePatchViews([patch])
  return realtimePatch
}
