'use client'

import { useEffect, useRef, useState } from 'react'
import { GalgameCard } from '~/components/galgame/Card'
import { kunFetchGet } from '~/utils/kunFetch'

interface PatchRealtimeStats {
  view?: number
  download?: number
}

interface Props {
  galgames: GalgameCard[]
}

const mergeRealtimeStats = (
  galgames: GalgameCard[],
  stats: Record<string, PatchRealtimeStats>
) =>
  galgames.map((galgame) => {
    const stat = stats[galgame.uniqueId]
    if (!stat) {
      return galgame
    }

    return {
      ...galgame,
      view:
        typeof stat.view === 'number'
          ? Math.max(galgame.view, stat.view)
          : galgame.view,
      download:
        typeof stat.download === 'number'
          ? Math.max(galgame.download, stat.download)
          : galgame.download
    }
  })

export const HomeGalgameGrid = ({ galgames }: Props) => {
  const [displayGalgames, setDisplayGalgames] = useState(galgames)
  const pending = useRef<{
    key: string
    promise: Promise<{ stats: Record<string, PatchRealtimeStats> }>
  } | null>(null)
  const requestKey = [
    ...new Set(galgames.map((galgame) => galgame.uniqueId))
  ].join(',')

  useEffect(() => {
    setDisplayGalgames(galgames)
  }, [galgames])

  useEffect(() => {
    if (!requestKey) {
      return
    }

    if (pending.current?.key !== requestKey) {
      pending.current = {
        key: requestKey,
        promise: kunFetchGet<{ stats: Record<string, PatchRealtimeStats> }>(
          '/patch/stats',
          {
            uniqueIds: requestKey
          }
        )
      }
    }

    let ignore = false
    pending.current.promise
      .then(({ stats }) => {
        if (ignore) {
          return
        }
        setDisplayGalgames((current) => mergeRealtimeStats(current, stats))
      })
      .catch((error) => {
        console.error('Failed to refresh home patch stats:', error)
      })

    return () => {
      ignore = true
    }
  }, [requestKey])

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
      {displayGalgames.map((galgame) => (
        <GalgameCard
          key={galgame.id}
          patch={galgame}
          openOnNewTab={false}
          prefetch={false}
          imageDecoding="async"
        />
      ))}
    </div>
  )
}
