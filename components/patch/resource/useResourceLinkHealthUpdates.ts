'use client'

import { useEffect, useRef, useState } from 'react'
import {
  healthViewFromLink,
  mergeHealthProjection,
  readLinkHealth,
  readSnapshotId
} from './linkHealthDisplay'
import type { LinkHealthSummary, LinkHealthView } from '~/types/api/linkHealth'
import type { PatchResource } from '~/types/api/patch'

const expiredReads = new Map<string, Promise<LinkHealthView | null>>()

/**
 * One public GET for an expired pause. The result is applied by the caller
 * only when the target, version and read origin still match. It never posts
 * a report and never replaces the resource object.
 */
export const requestExpiredHealthReread = (input: {
  patchId: number
  resourceId: number
  linkId: number
  version: number
  resumesAt: string
  snapshotId: number
  stillOrigin: () => boolean
}): Promise<LinkHealthView | null> => {
  const key = [
    input.snapshotId,
    input.patchId,
    input.resourceId,
    input.linkId,
    input.version,
    input.resumesAt
  ].join(':')
  const existing = expiredReads.get(key)
  if (existing) return existing
  const promise = (async () => {
    try {
      const { kunFetchGet } = await import('~/utils/kunFetch')
      const response = await kunFetchGet<PatchResource[] | string>(
        '/patch/resource',
        { patchId: input.patchId }
      )
      if (!input.stillOrigin() || !Array.isArray(response)) return null
      const fresh = response.find(
        (item) => item.id === input.resourceId && item.patchId === input.patchId
      )
      const link = fresh?.links.find((item) => item.id === input.linkId)
      if (!fresh || !link) return null
      const view = healthViewFromLink(fresh.patchId, fresh.id, link)
      if (
        !view ||
        view.patchId !== input.patchId ||
        view.resourceId !== input.resourceId ||
        view.linkId !== input.linkId ||
        view.version !== input.version ||
        !input.stillOrigin()
      ) {
        return null
      }
      return view
    } catch {
      return null
    }
  })()
  expiredReads.set(key, promise)
  return promise
}

/**
 * Page-level overlay for one read snapshot. Applying a result never clones
 * the resource: a new object identity is a real refetch and drops the overlay
 * together with access credentials. Health evidence and maintenance revision
 * merge separately, so an older health packet cannot clear a newer restriction.
 */
export const useResourceLinkHealthUpdates = (resource: PatchResource) => {
  const snapshotId = readSnapshotId(resource)
  const snapshotRef = useRef(snapshotId)
  snapshotRef.current = snapshotId
  const resourceRef = useRef(resource)
  resourceRef.current = resource
  const [healthUpdates, setHealthUpdates] = useState<
    Record<number, { view: LinkHealthSummary; snapshotId: number }>
  >({})

  useEffect(() => {
    setHealthUpdates({})
  }, [snapshotId])

  const healthUpdateFor = (linkId: number): LinkHealthSummary | null => {
    const entry = healthUpdates[linkId]
    return entry && entry.snapshotId === snapshotId ? entry.view : null
  }

  const onReported = (view: LinkHealthView) => {
    const originSnapshot = snapshotId
    if (originSnapshot !== snapshotRef.current) return
    const currentResource = resourceRef.current
    if (
      view.patchId !== currentResource.patchId ||
      view.resourceId !== currentResource.id
    ) {
      return
    }
    const link = currentResource.links.find((item) => item.id === view.linkId)
    const server = link ? readLinkHealth(link) : null
    if (!server || view.version !== server.version) return

    setHealthUpdates((current) => {
      if (readSnapshotId(resourceRef.current) !== originSnapshot) return current
      const previousEntry = current[view.linkId]
      const previous =
        previousEntry && previousEntry.snapshotId === originSnapshot
          ? previousEntry.view
          : null
      const next = mergeHealthProjection(
        mergeHealthProjection(server, previous),
        view
      )
      if (!next) return current
      return {
        ...current,
        [view.linkId]: { view: next, snapshotId: originSnapshot }
      }
    })
  }

  return { healthUpdateFor, onReported }
}
