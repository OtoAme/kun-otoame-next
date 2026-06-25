'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { GalgameCard } from '~/components/galgame/Card'
import type { HomeResource } from '~/types/api/home'
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
  const requestedKeyRef = useRef('')
  const homeFallbackPromiseRef = useRef<Promise<GalgameCard[]> | null>(null)
  const uniqueIds = useMemo(
    () => [...new Set(displayGalgames.map((galgame) => galgame.uniqueId))],
    [displayGalgames]
  )

  useEffect(() => {
    setDisplayGalgames(galgames)
  }, [galgames])

  useEffect(() => {
    if (galgames.length) {
      return
    }

    if (!homeFallbackPromiseRef.current) {
      homeFallbackPromiseRef.current = kunFetchGet<{
        galgames: GalgameCard[]
        resources: HomeResource[]
      }>('/home')
        .then(({ galgames: fallbackGalgames }) => fallbackGalgames)
        .catch((error) => {
          console.error('Failed to refresh empty home game payload:', error)
          return []
        })
    }

    let ignore = false

    homeFallbackPromiseRef.current.then((fallbackGalgames) => {
      if (ignore || !fallbackGalgames.length) {
        return
      }
      setDisplayGalgames(fallbackGalgames)
    })

    return () => {
      ignore = true
    }
  }, [galgames])

  useEffect(() => {
    if (!uniqueIds.length) {
      return
    }

    const requestKey = uniqueIds.join(',')
    if (requestedKeyRef.current === requestKey) {
      return
    }
    requestedKeyRef.current = requestKey

    let ignore = false
    kunFetchGet<{ stats: Record<string, PatchRealtimeStats> }>('/patch/stats', {
      uniqueIds: requestKey
    })
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
  }, [uniqueIds])

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
      {displayGalgames.map((galgame) => (
        <GalgameCard key={galgame.id} patch={galgame} openOnNewTab={false} />
      ))}
    </div>
  )
}
