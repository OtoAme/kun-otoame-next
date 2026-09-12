'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import { useDisclosure } from '@heroui/modal'
import { Spinner } from '@heroui/spinner'
import { Megaphone } from 'lucide-react'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet } from '~/utils/kunFetch'
import {
  resolveShoutboxCleanupMs,
  scheduleShoutboxDeadline
} from '~/utils/shoutboxVisibility'
import { ShoutboxCard } from './ShoutboxCard'
import {
  ShoutboxLoginModal,
  ShoutboxPublishModal
} from './ShoutboxPublishModal'
import type { ShoutboxPickedPatch } from './ShoutboxPublishForm'
import type { ShoutboxItem, ShoutboxListResponse } from '~/types/api/shoutbox'

interface Props {
  initialData: ShoutboxListResponse | null
  patchUniqueId?: string
}

const parseHighlightId = (raw: string | null): number | null => {
  if (!raw || !/^\d+$/.test(raw)) {
    return null
  }
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const ShoutboxContainer = ({ initialData, patchUniqueId }: Props) => {
  const searchParams = useSearchParams()
  const highlightParam = parseHighlightId(searchParams.get('shoutbox'))

  const [data, setData] = useState<ShoutboxListResponse | null>(initialData)
  const [page, setPage] = useState(initialData?.page ?? 1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(initialData === null)
  const [fetching, setFetching] = useState(false)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const dataRef = useRef<ShoutboxListResponse | null>(initialData)
  const pageRef = useRef(initialData?.page ?? 1)
  const seqRef = useRef(0)
  // Seq of the request currently in flight (0 = idle): automatic entries
  // merge into it; released only by the request that still owns it.
  const inFlightSeqRef = useRef(0)
  const publishModal = useDisclosure()
  const loginModal = useDisclosure()

  const currentUserId = useUserStore((state) => state.user.uid)

  const applyData = useCallback((next: ShoutboxListResponse | null) => {
    dataRef.current = next
    setData(next)
  }, [])

  const applyPage = useCallback((next: number) => {
    pageRef.current = next
    setPage(next)
  }, [])

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  // At the real visibility boundary (visibilityUntil, never TTL-truncated)
  // the current payload may no longer be valid; stale content is dropped
  // BEFORE the refetch starts. A patch-scoped payload's visibility is
  // decided server-side, so the whole payload goes. In the global stream
  // ordinary rows are public history and stay visible regardless of age; the
  // pinned slot is dropped unconditionally because the boundary may mark the
  // NEXT official message's effectiveFrom while the current pinned one's own
  // interval is still running — it must not stay pinned while the refresh is
  // pending or failed. A plain validUntil/TTL expiry drops nothing: it only
  // triggers a silent background refresh, and the new response replaces the
  // current content atomically.
  const dropStalePayload = useCallback(() => {
    const current = dataRef.current
    if (!current) {
      return
    }
    if (patchUniqueId) {
      applyData(null)
      return
    }
    if (current.pinned !== null) {
      applyData({ ...current, pinned: null })
    }
  }, [applyData, patchUniqueId])

  // All boundary paths (timers, immediate fire, visibility restore) go
  // through these guards: dropping the payload re-renders with the SAME old
  // deadlines, and without the guards the arming effect would fire again and
  // supersede the in-flight refresh with a duplicate request. The refresh
  // guard keys on validUntil (cache freshness), the cleanup guard on the
  // resolved real visibility boundary.
  const firedRefreshRef = useRef<string | null>(null)
  const firedCleanupRef = useRef<string | null>(null)

  // A failed or already-expired refresh must not leave the page stuck at a
  // dropped boundary: back off by the base cache duration (60s for the global
  // stream, 300s for a game-scoped view) and try again. Any new load (manual
  // page change, retry button, boundary) clears the pending one.
  const retryMs = patchUniqueId ? 300_000 : 60_000
  const scheduleRetry = useCallback(() => {
    clearRetryTimer()
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      void loadRef.current(pageRef.current, { automatic: true })
    }, retryMs)
  }, [clearRetryTimer, retryMs])

  const load = useCallback(
    async (
      targetPage: number,
      options?: { silent?: boolean; automatic?: boolean }
    ) => {
      // Automatic entries (TTL, real boundary, backoff, visibility restore)
      // merge into the request already in flight; manual page changes,
      // post-publish refreshes and the retry button always start a new seq.
      if (options?.automatic && inFlightSeqRef.current !== 0) {
        return
      }
      const seq = ++seqRef.current
      inFlightSeqRef.current = seq
      clearRetryTimer()
      if (!options?.silent && dataRef.current === null) {
        setLoading(true)
      }
      setFetching(true)
      setError('')
      try {
        const result = await kunFetchGet<ShoutboxListResponse | string>(
          '/shoutbox',
          {
            page: targetPage,
            limit: SHOUTBOX_PAGE_SIZE,
            ...(patchUniqueId ? { patch: patchUniqueId } : {})
          }
        )
        if (seq !== seqRef.current) {
          return
        }
        if (typeof result === 'string') {
          setError(result || '获取小喇叭失败，请稍后重试')
          scheduleRetry()
          return
        }
        applyData(result)
        applyPage(result.page)
        // A TTL already past on arrival (slow transit, or the server's
        // safe-empty fallback) only backs off freshness: the refresh guard
        // keeps the arming effect from re-firing at once and hot-looping,
        // and the applied payload stays on screen. Cleanup is judged
        // independently against the REAL boundary — only a passed (or
        // malformed) one drops the stale parts now; a future one stays
        // armable by the effect, and an explicit null time-cleans nothing.
        const validUntilMs = new Date(result.validUntil).getTime()
        if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
          firedRefreshRef.current = result.validUntil
          const cleanupMs = resolveShoutboxCleanupMs(result)
          if (
            cleanupMs !== null &&
            (!Number.isFinite(cleanupMs) || cleanupMs <= Date.now())
          ) {
            firedCleanupRef.current = String(cleanupMs)
            dropStalePayload()
          }
          scheduleRetry()
        }
      } catch {
        if (seq !== seqRef.current) {
          return
        }
        setError('网络错误，请稍后重试')
        scheduleRetry()
      } finally {
        if (inFlightSeqRef.current === seq) {
          inFlightSeqRef.current = 0
        }
        if (seq === seqRef.current) {
          setLoading(false)
          setFetching(false)
        }
      }
    },
    [
      applyData,
      applyPage,
      patchUniqueId,
      clearRetryTimer,
      scheduleRetry,
      dropStalePayload
    ]
  )

  // The server first page can lag a fresh publish or a just-crossed time
  // boundary because the shared list payload is cached for a short base
  // duration; silently refresh it once on mount like the message pages do.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])
  useEffect(() => {
    void loadRef.current(pageRef.current, { silent: true })
    return () => {
      // Invalidate this lifecycle's in-flight requests: a late response must
      // neither set state nor arm new timers after unmount or a patch switch.
      seqRef.current += 1
      clearRetryTimer()
    }
  }, [clearRetryTimer, patchUniqueId])

  // Cache-freshness (validUntil/TTL) expiry: silently refresh in the
  // background — the current rows and pinned slot stay on screen until the
  // new response replaces them atomically. When the real visibility boundary
  // is due at the same moment, the cleanup path owns the refetch instead, so
  // an old payload (where the two coincide) never triggers two requests.
  const fireRefresh = useCallback(() => {
    const current = dataRef.current
    if (!current || firedRefreshRef.current === current.validUntil) {
      return
    }
    const cleanupMs = resolveShoutboxCleanupMs(current)
    if (
      cleanupMs !== null &&
      (!Number.isFinite(cleanupMs) || cleanupMs <= Date.now())
    ) {
      return
    }
    firedRefreshRef.current = current.validUntil
    void loadRef.current(pageRef.current, { silent: true, automatic: true })
  }, [])

  // The real visibility boundary: conservative cleanup first — a patch
  // payload goes entirely, the global stream loses its pinned slot — then
  // exactly one refetch. This must fire on time even while a background
  // refresh is still in flight or backing off after a failure.
  const fireCleanup = useCallback(() => {
    const current = dataRef.current
    if (!current) {
      return
    }
    const cleanupMs = resolveShoutboxCleanupMs(current)
    if (cleanupMs === null) {
      return
    }
    const key = String(cleanupMs)
    if (firedCleanupRef.current === key) {
      return
    }
    firedCleanupRef.current = key
    dropStalePayload()
    void loadRef.current(pageRef.current, { automatic: true })
  }, [dropStalePayload])

  useEffect(() => {
    if (!data) {
      return
    }
    const now = Date.now()
    const validUntilMs = new Date(data.validUntil).getTime()
    const cleanupMs = resolveShoutboxCleanupMs(data)
    const cancels: Array<() => void> = []
    if (!Number.isFinite(validUntilMs) || validUntilMs <= now) {
      fireRefresh()
    } else {
      const timer = setTimeout(fireRefresh, validUntilMs - now)
      cancels.push(() => clearTimeout(timer))
    }
    if (cleanupMs !== null) {
      if (!Number.isFinite(cleanupMs) || cleanupMs <= now) {
        fireCleanup()
      } else {
        // The real boundary may sit beyond setTimeout's 32-bit delay range:
        // wait in segments that re-check the absolute deadline before firing.
        cancels.push(scheduleShoutboxDeadline(cleanupMs, fireCleanup))
      }
    }
    return () => {
      for (const cancel of cancels) {
        cancel()
      }
    }
  }, [data, fireRefresh, fireCleanup])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const current = dataRef.current
      if (!current) {
        return
      }
      const now = Date.now()
      const cleanupMs = resolveShoutboxCleanupMs(current)
      if (
        cleanupMs !== null &&
        (!Number.isFinite(cleanupMs) || cleanupMs <= now)
      ) {
        fireCleanup()
        return
      }
      const validUntilMs = new Date(current.validUntil).getTime()
      if (!Number.isFinite(validUntilMs) || validUntilMs <= now) {
        fireRefresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [fireRefresh, fireCleanup])

  // Notification deep links (/shoutbox?shoutbox=<id>): when the target
  // message is on the current page, scroll to it and highlight it.
  useEffect(() => {
    if (!highlightParam || !data) {
      setHighlightId(null)
      return
    }
    const element = document.getElementById(`shoutbox-${highlightParam}`)
    if (!element) {
      setHighlightId(null)
      return
    }
    setHighlightId(highlightParam)
    element.scrollIntoView({ block: 'center' })
  }, [highlightParam, data])

  const handlePageChange = (next: number) => {
    if (next === pageRef.current) {
      return
    }
    applyPage(next)
    void load(next)
  }

  const handlePublished = (_item: ShoutboxItem) => {
    publishModal.onClose()
    // A fresh message lands at the top of page 1: jump there so the author
    // can confirm it immediately.
    applyPage(1)
    void load(1)
  }

  const handleChanged = (updated: ShoutboxItem) => {
    const current = dataRef.current
    if (!current) {
      return
    }
    applyData({
      ...current,
      pinned:
        current.pinned && current.pinned.id === updated.id
          ? updated
          : current.pinned,
      shoutboxes: current.shoutboxes.map((row) =>
        row.id === updated.id ? updated : row
      )
    })
  }

  const handleDeleted = (id: number) => {
    const current = dataRef.current
    if (!current) {
      return
    }
    applyData({
      ...current,
      shoutboxes: current.shoutboxes.filter((row) => row.id !== id)
    })
  }

  const handleClickPublish = () => {
    if (currentUserId > 0) {
      publishModal.onOpen()
    } else {
      loginModal.onOpen()
    }
  }

  // Per-game mode: the association preset can only come from a visible row of
  // this game (its summary carries the numeric id). When it exists the form
  // preselects and locks to this game; when the game has no visible messages
  // yet the form stays the normal optional search, with no preset claimed.
  const presetPatch: ShoutboxPickedPatch | null = patchUniqueId
    ? (data?.shoutboxes.find((row) => row.patch)?.patch ?? null)
    : null
  const patchName = presetPatch?.name ?? null

  const rows = data?.shoutboxes ?? []
  const totalPages = data?.totalPages ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Megaphone className="size-5 text-primary" aria-hidden />
            {patchUniqueId ? '关联小喇叭' : '小喇叭'}
          </h1>
          <p className="mt-1 text-sm text-default-500">
            {patchUniqueId && patchName
              ? `只显示关联「${patchName}」的小喇叭`
              : '一句话广播，最新在最前'}
          </p>
        </div>
        {patchUniqueId && (
          <Button as={Link} href="/shoutbox" variant="light" size="sm">
            查看全部小喇叭
          </Button>
        )}
        <Button color="primary" onPress={handleClickPublish}>
          发布小喇叭
        </Button>
      </div>

      {error && (
        <Alert
          color="danger"
          variant="flat"
          description={error}
          endContent={
            <Button
              size="sm"
              variant="light"
              color="danger"
              onPress={() => void load(pageRef.current)}
            >
              重试
            </Button>
          }
        />
      )}

      {loading && !data ? (
        <div className="flex size-full items-center justify-center">
          <Spinner
            variant="default"
            size="md"
            color="primary"
            label="正在获取小喇叭..."
          />
        </div>
      ) : !rows.length && !data?.pinned ? (
        <KunNull
          message={
            patchUniqueId
              ? '这部作品还没有关联的小喇叭'
              : '暂无小喇叭，来发第一条吧'
          }
        />
      ) : (
        <div className="divide-y divide-default-100">
          {data?.pinned && (
            <ShoutboxCard
              item={data.pinned}
              pinned
              compact
              highlight={highlightId === data.pinned.id}
              currentUserId={currentUserId}
              onChanged={handleChanged}
              onDeleted={handleDeleted}
            />
          )}
          {rows.map((item) => (
            <ShoutboxCard
              key={item.id}
              item={item}
              compact
              highlight={highlightId === item.id}
              currentUserId={currentUserId}
              onChanged={handleChanged}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center">
          <KunPagination
            total={totalPages}
            page={page}
            onPageChange={handlePageChange}
            isLoading={fetching}
          />
        </div>
      )}

      <ShoutboxPublishModal
        isOpen={publishModal.isOpen}
        onOpenChange={publishModal.onOpenChange}
        presetPatch={presetPatch}
        lockPatchSelection={presetPatch !== null}
        onPublished={handlePublished}
      />

      <ShoutboxLoginModal
        isOpen={loginModal.isOpen}
        onOpenChange={loginModal.onOpenChange}
      />
    </div>
  )
}
