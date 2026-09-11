'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { kunFetchGet } from '~/utils/kunFetch'
import type { DashboardStatsSumData, OverviewData } from '~/types/api/admin'

export const OVERVIEW_DEFAULT_DAYS = 1
export const OVERVIEW_MIN_DAYS = 1
export const OVERVIEW_MAX_DAYS = 60

// Full stats (sum + overview) are private to reviewers with role >= 4.
export const DASHBOARD_STATS_MIN_ROLE = 4

export interface StatsBlock<T> {
  data: T | null
  loading: boolean
  error: string
}

const emptyBlock = <T>(): StatsBlock<T> => ({
  data: null,
  loading: false,
  error: ''
})

export function isValidOverviewDays(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= OVERVIEW_MIN_DAYS &&
    value <= OVERVIEW_MAX_DAYS
  )
}

export interface DashboardStatsState {
  canViewStats: boolean
  summary: StatsBlock<DashboardStatsSumData>
  overview: StatsBlock<OverviewData>
  days: number
  loadSummary: () => Promise<void>
  loadOverview: (days: number) => Promise<void>
}

export function useDashboardStats(reviewerRole: number): DashboardStatsState {
  const canViewStats = reviewerRole >= DASHBOARD_STATS_MIN_ROLE
  // With permission the first render is already about to load; a block that
  // was never requested must read as loading, never as a failure.
  const [summary, setSummary] = useState<StatsBlock<DashboardStatsSumData>>(
    () =>
      canViewStats ? { data: null, loading: true, error: '' } : emptyBlock()
  )
  const [overview, setOverview] = useState<StatsBlock<OverviewData>>(() =>
    canViewStats ? { data: null, loading: true, error: '' } : emptyBlock()
  )
  const [days, setDays] = useState(OVERVIEW_DEFAULT_DAYS)

  const mountedRef = useRef(false)
  // Live mirrors readable from in-flight async completions: a downgrade
  // that lands while a request is pending must still mask the response.
  const canViewStatsRef = useRef(canViewStats)
  const daysRef = useRef(OVERVIEW_DEFAULT_DAYS)
  const summaryGenerationRef = useRef(0)
  const overviewGenerationRef = useRef(0)

  useEffect(() => {
    canViewStatsRef.current = canViewStats
  }, [canViewStats])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Invalidate completions from this effect cycle (unmount / replay).
      summaryGenerationRef.current += 1
      overviewGenerationRef.current += 1
    }
  }, [])

  const loadSummary = useCallback(async (): Promise<void> => {
    if (!mountedRef.current || !canViewStatsRef.current) {
      return
    }
    const generation = ++summaryGenerationRef.current
    setSummary((previous) => ({ ...previous, loading: true, error: '' }))
    try {
      const result = await kunFetchGet<DashboardStatsSumData | string>(
        '/admin/stats/sum'
      )
      if (
        !mountedRef.current ||
        !canViewStatsRef.current ||
        generation !== summaryGenerationRef.current
      ) {
        return
      }
      if (typeof result === 'string') {
        // Any string (including the empty string) is an error message.
        // Keep previously loaded data, only surface the failure.
        setSummary((previous) => ({
          ...previous,
          loading: false,
          error: result || '获取总量统计失败'
        }))
      } else {
        setSummary({ data: result, loading: false, error: '' })
      }
    } catch {
      if (
        !mountedRef.current ||
        !canViewStatsRef.current ||
        generation !== summaryGenerationRef.current
      ) {
        return
      }
      setSummary((previous) => ({
        ...previous,
        loading: false,
        error: '获取总量统计失败，请检查网络后重试'
      }))
    }
  }, [])

  const loadOverview = useCallback(
    async (targetDays: number): Promise<void> => {
      if (!isValidOverviewDays(targetDays)) {
        return
      }
      if (!mountedRef.current || !canViewStatsRef.current) {
        return
      }
      const samePeriod = targetDays === daysRef.current
      const generation = ++overviewGenerationRef.current
      daysRef.current = targetDays
      setDays(targetDays)
      setOverview((previous) => ({
        // A new window must never show values from the previous window;
        // a same-window refresh may keep its values while reloading.
        data: samePeriod ? previous.data : null,
        loading: true,
        error: ''
      }))
      try {
        const result = await kunFetchGet<OverviewData | string>(
          '/admin/stats',
          { days: targetDays }
        )
        if (
          !mountedRef.current ||
          !canViewStatsRef.current ||
          generation !== overviewGenerationRef.current
        ) {
          return
        }
        if (typeof result === 'string') {
          setOverview((previous) => ({
            ...previous,
            loading: false,
            error: result || '获取近期统计失败'
          }))
        } else {
          setOverview({ data: result, loading: false, error: '' })
        }
      } catch {
        if (
          !mountedRef.current ||
          !canViewStatsRef.current ||
          generation !== overviewGenerationRef.current
        ) {
          return
        }
        setOverview((previous) => ({
          ...previous,
          loading: false,
          error: '获取近期统计失败，请检查网络后重试'
        }))
      }
    },
    []
  )

  // Private stats load only for role >= 4. A downgrade masks loaded data
  // immediately and invalidates in-flight requests so a late response can
  // never write private numbers back; an upgrade reloads from scratch.
  useEffect(() => {
    if (!canViewStats) {
      summaryGenerationRef.current += 1
      overviewGenerationRef.current += 1
      daysRef.current = OVERVIEW_DEFAULT_DAYS
      setDays(OVERVIEW_DEFAULT_DAYS)
      setSummary(emptyBlock())
      setOverview(emptyBlock())
      return
    }
    void loadSummary()
    void loadOverview(OVERVIEW_DEFAULT_DAYS)
  }, [canViewStats, loadSummary, loadOverview])

  return {
    canViewStats,
    summary,
    overview,
    days,
    loadSummary,
    loadOverview
  }
}
