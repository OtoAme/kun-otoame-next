'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { kunFetchGet } from '~/utils/kunFetch'
import {
  decideResolvedRedirect,
  parseResolvedResource,
  type ResolvedResourceLocation
} from './mergedResourceLocation'

/**
 * 旧资源 ID 在列表加载完成后最多查找一次。
 * 缓存里仍有该 ID、但操作返回资源不存在时，另允许一次重定位。
 * 地址变化会使代数增加，更早的响应用于替换。
 */
export const useMergedResourceNavigation = ({
  resources,
  listReady
}: {
  resources: readonly { id: number }[]
  listReady: boolean
}) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const generation = useRef(0)
  const locationKey = `${pathname}?${searchParams.toString()}`
  const previousKey = useRef(locationKey)
  if (previousKey.current !== locationKey) {
    previousKey.current = locationKey
    generation.current += 1
  }
  const navigationTried = useRef(new Set<number>())
  const operationTried = useRef(new Set<number>())
  const destinations = useRef(new Set<number>())
  const mounted = useRef(true)
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const targetResourceId = (() => {
    const raw = searchParams.get('resourceId')
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  })()

  const run = useCallback(
    async (resourceId: number, requestGeneration: number) => {
      let location: ResolvedResourceLocation | null = null
      try {
        const body = await kunFetchGet<unknown>('/patch/resource/resolve', {
          resourceId
        })
        location = parseResolvedResource(body)
      } catch {
        location = null
      }
      if (!mounted.current) return false
      const decision = decideResolvedRedirect({
        location,
        requestGeneration,
        currentGeneration: generation.current,
        attemptedDestinationIds: destinations.current,
        currentHref: `${pathname}?${searchParams.toString()}`
      })
      if (!decision) return false
      destinations.current.add(decision.destinationId)
      navigationTried.current.add(decision.destinationId)
      router.replace(decision.href)
      return true
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    if (!listReady || targetResourceId === null) return
    if (resources.some((resource) => resource.id === targetResourceId)) return
    if (navigationTried.current.has(targetResourceId)) return
    navigationTried.current.add(targetResourceId)
    void run(targetResourceId, generation.current)
  }, [listReady, resources, run, targetResourceId])

  const relocateCachedMiss = useCallback(
    async (resourceId: number) => {
      if (
        !resourcesRef.current.some((resource) => resource.id === resourceId)
      ) {
        return false
      }
      if (operationTried.current.has(resourceId)) return false
      operationTried.current.add(resourceId)
      return run(resourceId, generation.current)
    },
    [run]
  )

  return { relocateCachedMiss }
}
