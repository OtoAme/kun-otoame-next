'use client'

import { useEffect, useRef, useState } from 'react'
import { readSnapshotId } from './linkHealthDisplay'
import type { LinkHealthSummary, LinkHealthView } from '~/types/api/linkHealth'
import type { PatchResource } from '~/types/api/patch'

export const useResourceLinkHealthUpdates = (resource: PatchResource) => {
  const [healthUpdates, setHealthUpdates] = useState<
    Record<number, { view: LinkHealthSummary; snapshotId: number }>
  >({})
  useEffect(() => {
    setHealthUpdates({})
  }, [resource])
  const snapshotId = readSnapshotId(resource)
  const currentSnapshotRef = useRef(snapshotId)
  currentSnapshotRef.current = snapshotId

  const healthUpdateFor = (linkId: number): LinkHealthSummary | null => {
    const entry = healthUpdates[linkId]
    return entry && entry.snapshotId === snapshotId ? entry.view : null
  }

  const onReported = (view: LinkHealthView) => {
    if (snapshotId !== currentSnapshotRef.current) {
      return
    }
    setHealthUpdates((current) => ({
      ...current,
      [view.linkId]: { view, snapshotId }
    }))
  }

  return { healthUpdateFor, onReported }
}
