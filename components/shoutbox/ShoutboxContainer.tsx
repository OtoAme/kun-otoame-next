'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import { Megaphone } from 'lucide-react'
import { KunLoading } from '~/components/kun/Loading'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet } from '~/utils/kunFetch'
import { ShoutboxCard } from './ShoutboxCard'
import {
  ShoutboxPublishForm,
  type ShoutboxPickedPatch
} from './ShoutboxPublishForm'
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

  // At validUntil the current payload may no longer be valid; stale content
  // is dropped BEFORE the refetch starts. A patch-scoped payload can contain
  // rows that are visible only through the three-month retention rule while
  // the slot boundary is server-side, so the whole payload goes. In the
  // global stream only ordinary rows are age-independent; the pinned slot is
  // dropped unconditionally because validUntil may mark the NEXT official
  // message's effectiveFrom while the current pinned one's own interval is
  // still running — it must not stay pinned while the refresh is pending or
  // failed.
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

  // All three boundary paths (timer, immediate fire, visibility restore) go
  // through this guard: dropping the payload re-renders with the SAME old
  // validUntil, and without the guard the effect would fire again and
  // supersede the in-flight refresh with a duplicate request.
  const firedForValidUntilRef = useRef<string | null>(null)

  // A failed or already-expired refresh must not leave the page stuck at a
  // dropped boundary: back off by the base cache duration (60s for the global
  // stream, 300s for a game-scoped view) and try again. Any new load (manual
  // page change, retry button, boundary) clears the pending one.
  const retryMs = patchUniqueId ? 300_000 : 60_000
  const scheduleRetry = useCallback(() => {
    clearRetryTimer()
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      void loadRef.current(pageRef.current)
    }, retryMs)
  }, [clearRetryTimer, retryMs])

  const load = useCallback(
    async (targetPage: number, options?: { silent?: boolean }) => {
      const seq = ++seqRef.current
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
        // A payload whose validUntil is invalid or already past (e.g. the
        // server's safe-empty fallback) must never enter the immediate
        // boundary path — the effect would fire again at once and hot-loop.
        // Mirror useShoutboxFeed: keep the rows minus certainly-stale parts
        // and silently back off by the base cache duration.
        const validUntilMs = new Date(result.validUntil).getTime()
        if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
          firedForValidUntilRef.current = result.validUntil
          dropStalePayload()
          scheduleRetry()
        }
      } catch {
        if (seq !== seqRef.current) {
          return
        }
        setError('网络错误，请稍后重试')
        scheduleRetry()
      } finally {
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
    return () => clearRetryTimer()
  }, [clearRetryTimer])

  const fireBoundary = useCallback(() => {
    const current = dataRef.current
    if (!current || firedForValidUntilRef.current === current.validUntil) {
      return
    }
    firedForValidUntilRef.current = current.validUntil
    dropStalePayload()
    void loadRef.current(pageRef.current)
  }, [dropStalePayload])

  useEffect(() => {
    if (!data) {
      return
    }
    const validUntilMs = new Date(data.validUntil).getTime()
    if (!Number.isFinite(validUntilMs)) {
      return
    }
    const delay = validUntilMs - Date.now()
    if (delay <= 0) {
      fireBoundary()
      return
    }
    const timer = setTimeout(fireBoundary, delay)
    return () => clearTimeout(timer)
  }, [data, fireBoundary])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const current = dataRef.current
      if (!current) {
        return
      }
      const validUntilMs = new Date(current.validUntil).getTime()
      if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
        fireBoundary()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [fireBoundary])

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
        <KunLoading hint="正在获取小喇叭..." />
      ) : !rows.length && !data?.pinned ? (
        <KunNull
          message={
            patchUniqueId
              ? '这部作品还没有关联的小喇叭'
              : '暂无小喇叭，来发第一条吧'
          }
        />
      ) : (
        <div className="space-y-3">
          {data?.pinned && (
            <ShoutboxCard
              item={data.pinned}
              pinned
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

      <Modal
        isOpen={publishModal.isOpen}
        onOpenChange={publishModal.onOpenChange}
        placement="center"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>发布小喇叭</ModalHeader>
          <ModalBody className="pb-6">
            <ShoutboxPublishForm
              key={presetPatch?.id ?? 'none'}
              presetPatch={presetPatch}
              lockPatchSelection={presetPatch !== null}
              onPublished={handlePublished}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={loginModal.isOpen}
        onOpenChange={loginModal.onOpenChange}
        placement="center"
      >
        <ModalContent>
          <ModalHeader>请先登录</ModalHeader>
          <ModalBody className="pb-6">
            <p className="text-sm text-default-500">
              发布小喇叭需要先登录账号。
            </p>
            <div className="mt-3 flex gap-2">
              <Button as={Link} href="/login" color="primary">
                登录
              </Button>
              <Button as={Link} href="/register" variant="bordered">
                注册
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  )
}
