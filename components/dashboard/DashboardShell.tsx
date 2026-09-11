'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

import { kunFetchGet } from '~/utils/kunFetch'
import type { InboxCounts } from '~/types/api/inbox'
import {
  SidebarInset,
  SidebarProvider
} from '~/components/dashboard/ui/sidebar'

import { DashboardSidebar } from './DashboardSidebar'
import { DashboardHeader } from './DashboardHeader'

export interface DashboardCurrentUser {
  id: number
  name: string
  role: number
}

export interface DashboardContextValue {
  counts: InboxCounts | null
  countsLoading: boolean
  countsError: string
  refreshCounts: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboard must be used within DashboardShell')
  }
  return context
}

const COUNTS_POLL_INTERVAL = 60_000

interface DashboardShellProps {
  currentUser: DashboardCurrentUser
  children: ReactNode
}

export function DashboardShell({ currentUser, children }: DashboardShellProps) {
  const [counts, setCounts] = useState<InboxCounts | null>(null)
  const [countsLoading, setCountsLoading] = useState(true)
  const [countsError, setCountsError] = useState('')
  const mountedRef = useRef(false)
  const requestGeneration = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)

  // Performs exactly one request. Never rejects, never issues a network
  // request when unmounted, and every setState is guarded by mounted +
  // generation checks so stale or post-unmount completions cannot write.
  const performRequest = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) {
      return
    }
    const generation = ++requestGeneration.current
    setCountsLoading(true)
    try {
      const result = await kunFetchGet<InboxCounts | string>(
        '/admin/inbox/counts'
      )
      if (!mountedRef.current || generation !== requestGeneration.current) {
        return
      }
      if (typeof result === 'string') {
        // Keep previously loaded counts, only surface the error.
        setCountsError(result || '获取待办计数失败')
      } else {
        setCounts(result)
        setCountsError('')
      }
    } catch {
      if (!mountedRef.current || generation !== requestGeneration.current) {
        return
      }
      setCountsError('获取待办计数失败，请检查网络后重试')
    } finally {
      if (mountedRef.current && generation === requestGeneration.current) {
        setCountsLoading(false)
      }
    }
  }, [])

  // Serialized refresh: wait (re-checking in a loop, since multiple callers
  // may resume from the same promise) until no request is in flight, then
  // issue exactly one fresh request so callers never reuse pre-action
  // counts. Never issues a request after unmount. Settled Promise<void>.
  const refreshCounts = useCallback(async (): Promise<void> => {
    while (inFlightRef.current) {
      await inFlightRef.current
    }
    if (!mountedRef.current) {
      return
    }
    const request = performRequest()
    inFlightRef.current = request
    try {
      await request
    } finally {
      if (inFlightRef.current === request) {
        inFlightRef.current = null
      }
    }
  }, [performRequest])

  useEffect(() => {
    mountedRef.current = true
    void refreshCounts()
    const timer = window.setInterval(() => {
      // Polling never overlaps: skip this tick while a request is busy.
      if (inFlightRef.current) {
        return
      }
      void refreshCounts()
    }, COUNTS_POLL_INTERVAL)
    return () => {
      mountedRef.current = false
      // Invalidate the generation so completions from this effect cycle
      // cannot write state after unmount or strict-mode effect replay.
      requestGeneration.current += 1
      window.clearInterval(timer)
    }
  }, [refreshCounts])

  const contextValue = useMemo<DashboardContextValue>(
    () => ({ counts, countsLoading, countsError, refreshCounts }),
    [counts, countsLoading, countsError, refreshCounts]
  )

  return (
    <DashboardContext.Provider value={contextValue}>
      <SidebarProvider className="h-svh overflow-hidden">
        <DashboardSidebar currentUser={currentUser} />
        <SidebarInset className="min-h-0 min-w-0">
          <DashboardHeader />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </DashboardContext.Provider>
  )
}
