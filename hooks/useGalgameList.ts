'use client'

import { useEffect, useRef, useState } from 'react'
import { useBrowsingScope } from './useBrowsingScope'
import { useUserStore } from '~/store/userStore'
import { getBrowsingScopeKey } from '~/utils/browsingScope'
import { kunFetchGet } from '~/utils/kunFetch'
import type { SessionRenderState } from '~/types/api/session'

interface GalgameListData {
  galgames: GalgameCard[]
  total: number
}

export const useGalgameList = (
  endpoint: string,
  query: Record<string, string | number>,
  initialData: GalgameListData,
  initialScope: SessionRenderState | null,
  enabled = true
) => {
  const scope = useBrowsingScope(initialScope)
  const generation = useUserStore((state) => state.sessionGeneration)
  const queryString = JSON.stringify(query)
  const key = scope.key
    ? JSON.stringify([generation, scope.key, queryString])
    : null
  const [result, setResult] = useState(() => ({
    key: initialScope
      ? JSON.stringify([
          generation,
          getBrowsingScopeKey(initialScope),
          queryString
        ])
      : null,
    data: initialData
  }))
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const pending = useRef<{
    key: string
    promise: Promise<GalgameListData | string>
  } | null>(null)
  const currentKey = useRef(key)
  currentKey.current = key

  useEffect(() => {
    if (!enabled) {
      pending.current = null
      setResult((current) => ({ ...current, key: null }))
      return
    }
    if (!scope.ready || !key || result.key === key || failedKey === key) return
    let active = true
    if (pending.current?.key !== key) {
      pending.current = {
        key,
        promise: kunFetchGet<GalgameListData | string>(
          endpoint,
          JSON.parse(queryString)
        )
      }
    }
    void pending.current.promise
      .then((data) => {
        if (!active || currentKey.current !== key) return
        if (typeof data === 'string') {
          setFailedKey(key)
        } else {
          setResult({ key, data })
          setFailedKey(null)
        }
      })
      .catch(() => {
        if (active && currentKey.current === key) setFailedKey(key)
      })
    return () => {
      active = false
    }
  }, [endpoint, key, queryString, scope.ready, enabled, retryCount])

  return {
    ...result.data,
    ready: scope.ready,
    loading: enabled && (key === null || result.key !== key),
    error: key !== null && failedKey === key,
    retry: () => {
      pending.current = null
      setFailedKey(null)
      setRetryCount((value) => value + 1)
    }
  }
}
