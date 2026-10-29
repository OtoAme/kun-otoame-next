'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { kunFetchGet } from '~/utils/kunFetch'
import type { AdminLog, AdminRedirectConfig } from '~/types/api/admin'
import type { CompanyMergeSuggestionListResponse } from '~/types/api/companyMerges'
import {
  CONTENT_REVIEW_KINDS,
  type InboxItem,
  type InboxListResponse
} from '~/types/api/inbox'

import type { StatsBlock } from './useDashboardStats'

export const OVERVIEW_OLDEST_LIMIT = 6
export const OVERVIEW_LOG_LIMIT = 8
const SETTINGS_MIN_ROLE = 4
export const LOG_MIN_ROLE = 3

export interface OverviewSiteSettings {
  disableRegister: boolean
  redirect: AdminRedirectConfig
}

const idle = <T>(): StatsBlock<T> => ({ data: null, loading: false, error: '' })
const pending = <T>(): StatsBlock<T> => ({
  data: null,
  loading: true,
  error: ''
})

type Fetcher<T> = () => Promise<T | string>

/**
 * One independently loaded overview panel. Responses that land after the
 * panel was reloaded, unmounted or lost permission are dropped, and a failed
 * reload keeps the last good data next to the error.
 */
function usePanel<T>(
  enabled: boolean,
  fetcher: Fetcher<T>,
  fallbackError: string
) {
  const [block, setBlock] = useState<StatsBlock<T>>(() =>
    enabled ? pending<T>() : idle<T>()
  )
  const generation = useRef(0)
  const enabledRef = useRef(enabled)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(async () => {
    if (!enabledRef.current) return
    const current = ++generation.current
    setBlock((previous) => ({ ...previous, loading: true, error: '' }))
    try {
      const result = await fetcherRef.current()
      if (current !== generation.current || !enabledRef.current) return
      if (typeof result === 'string') {
        setBlock((previous) => ({
          ...previous,
          loading: false,
          error: result || fallbackError
        }))
      } else {
        setBlock({ data: result, loading: false, error: '' })
      }
    } catch {
      if (current !== generation.current || !enabledRef.current) return
      setBlock((previous) => ({
        ...previous,
        loading: false,
        error: `${fallbackError}，请检查网络后重试`
      }))
    }
  }, [fallbackError])

  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      generation.current += 1
      setBlock(idle<T>())
      return
    }
    void load()
    return () => {
      generation.current += 1
    }
  }, [enabled, load])

  return [block, load] as const
}

const fetchOldest: Fetcher<InboxItem[]> = async () => {
  // Each source is already oldest-first, so the global oldest few are always
  // inside every source's first few.
  const result = await kunFetchGet<InboxListResponse | string>('/admin/inbox', {
    kinds: CONTENT_REVIEW_KINDS.join(','),
    limitPerKind: OVERVIEW_OLDEST_LIMIT
  })
  if (typeof result === 'string') return result
  return result.items.slice(0, OVERVIEW_OLDEST_LIMIT)
}

const fetchMergeCount: Fetcher<number> = async () => {
  const result = await kunFetchGet<CompanyMergeSuggestionListResponse | string>(
    '/admin/company-merges',
    { status: 'pending' }
  )
  return typeof result === 'string' ? result : result.items.length
}

// With one row per page the page count is the number of shoutboxes waiting
// for review (status 2 or with an open report).
const fetchShoutboxReviewCount: Fetcher<number> = async () => {
  const result = await kunFetchGet<{ totalPages: number } | string>(
    '/admin/shoutbox',
    { tab: 'pending_review', page: 1, limit: 1 }
  )
  return typeof result === 'string' ? result : result.totalPages
}

const fetchCreatorCount: Fetcher<number> = async () => {
  const result = await kunFetchGet<{ total: number } | string>(
    '/admin/creator',
    { page: 1, limit: 1, status: 'pending' }
  )
  return typeof result === 'string' ? result : result.total
}

const fetchLogs: Fetcher<AdminLog[]> = async () => {
  const result = await kunFetchGet<
    { logs: AdminLog[]; total: number } | string
  >('/admin/log', { page: 1, limit: OVERVIEW_LOG_LIMIT })
  return typeof result === 'string' ? result : result.logs
}

const fetchSettings: Fetcher<OverviewSiteSettings> = async () => {
  const [register, redirect] = await Promise.all([
    kunFetchGet<{ disableRegister: boolean } | string>(
      '/admin/setting/register'
    ),
    kunFetchGet<AdminRedirectConfig | string>('/admin/setting/redirect')
  ])
  if (typeof register === 'string') return register
  if (typeof redirect === 'string') return redirect
  return { disableRegister: register.disableRegister, redirect }
}

/** Overview panels beyond the stats blocks; each loads on entry and refresh. */
export function useOverviewPanels(reviewerRole: number) {
  const [oldest, loadOldest] = usePanel(true, fetchOldest, '获取最早的待审失败')
  const [mergeCount, loadMergeCount] = usePanel(
    true,
    fetchMergeCount,
    '获取会社合并建议数失败'
  )
  const [creatorCount, loadCreatorCount] = usePanel(
    true,
    fetchCreatorCount,
    '获取创作者申请数失败'
  )
  const [shoutboxCount, loadShoutboxCount] = usePanel(
    true,
    fetchShoutboxReviewCount,
    '获取小喇叭待复核数失败'
  )
  const [logs, loadLogs] = usePanel(
    reviewerRole >= LOG_MIN_ROLE,
    fetchLogs,
    '获取管理日志失败'
  )
  const [settings, loadSettings] = usePanel(
    reviewerRole >= SETTINGS_MIN_ROLE,
    fetchSettings,
    '获取站点状态失败'
  )

  const refreshAll = useCallback(() => {
    void loadOldest()
    void loadMergeCount()
    void loadCreatorCount()
    void loadShoutboxCount()
    void loadLogs()
    void loadSettings()
  }, [
    loadOldest,
    loadMergeCount,
    loadCreatorCount,
    loadShoutboxCount,
    loadLogs,
    loadSettings
  ])

  return {
    oldest,
    mergeCount,
    creatorCount,
    shoutboxCount,
    logs,
    settings,
    loadOldest,
    loadMergeCount,
    loadCreatorCount,
    loadShoutboxCount,
    loadLogs,
    loadSettings,
    refreshAll
  }
}
