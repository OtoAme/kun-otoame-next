'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Alert } from '@heroui/alert'
import { Button } from '@heroui/button'
import { useDisclosure } from '@heroui/modal'
import { Spinner } from '@heroui/spinner'
import { Megaphone } from 'lucide-react'
import toast from 'react-hot-toast'
import { KunNull } from '~/components/kun/Null'
import { KunPagination } from '~/components/kun/Pagination'
import { useShoutboxQuery } from '~/components/shoutbox/query/useShoutboxQuery'
import {
  getShoutboxContextKeyPart,
  normalizeShoutboxContext
} from '~/components/shoutbox/query/core'
import { useShoutboxQueryContext } from '~/components/shoutbox/query/ShoutboxQueryProvider'
import { useUserStore } from '~/store/userStore'
import {
  projectShoutboxGlobalListDisplay,
  projectShoutboxPatchListDisplay,
  resolveShoutboxCleanupMs,
  scheduleShoutboxDeadline
} from '~/utils/shoutboxVisibility'
import { ShoutboxCard } from './ShoutboxCard'
import {
  ShoutboxLoginModal,
  ShoutboxPublishModal
} from './ShoutboxPublishModal'
import type { ShoutboxPickedPatch } from './ShoutboxPublishForm'
import type {
  ShoutboxItem,
  ShoutboxListResponse,
  ShoutboxRequestContext
} from '~/types/api/shoutbox'

interface Props {
  initialData: ShoutboxListResponse | null
  patchUniqueId?: string
  /**
   * The request context the SSR first page was rendered with (request uid +
   * the normalized visibility context). It seeds only the matching query
   * key; a client-side scope that differs (e.g. an anonymous non-default
   * rating, which the API derives straight from the cookie) gets one fresh
   * read after client-ready instead of inheriting the SSR payload.
   */
  initialContext?: ShoutboxRequestContext
}

const parseHighlightId = (raw: string | null): number | null => {
  if (!raw || !/^\d+$/.test(raw)) {
    return null
  }
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const ShoutboxContainer = ({
  initialData,
  patchUniqueId,
  initialContext
}: Props) => {
  const searchParams = useSearchParams()
  const highlightParam = parseHighlightId(searchParams.get('shoutbox'))

  const [page, setPage] = useState(initialData?.page ?? 1)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const publishModal = useDisclosure()
  const loginModal = useDisclosure()

  const currentUserId = useUserStore((state) => state.user.uid)
  const { clientReady, scope } = useShoutboxQueryContext()

  // The SSR seed is frozen at the very first render: SSR and the first
  // hydration always display it under the SSR context; after client-ready
  // the container switches to the live API context.
  const seedRef = useRef<{
    context: ShoutboxRequestContext
    data: ShoutboxListResponse
  } | null>(null)
  if (seedRef.current === null && initialData !== null) {
    seedRef.current = {
      context: normalizeShoutboxContext(initialContext ?? scope),
      data: initialData
    }
  }
  const seed = seedRef.current
  const activeScope = clientReady ? scope : (seed?.context ?? scope)

  // SSR and first hydration always seed under the SSR request context; after
  // client-ready (i.e. any client-side navigation) only a payload still
  // inside its freshness window may seed a brand-new matching query, and an
  // expired SSR page refetches immediately (initialDataUpdatedAt 0 marks the
  // seed as received inside its own validity window, not stale-on-arrival).
  const seedFresh =
    seed !== null && Date.parse(seed.data.validUntil) > Date.now()
  const query = useShoutboxQuery<ShoutboxListResponse>({
    view: 'list',
    page,
    patch: patchUniqueId ?? null,
    scopeOverride: activeScope,
    project: patchUniqueId
      ? projectShoutboxPatchListDisplay
      : projectShoutboxGlobalListDisplay,
    keepPreviousWhileLoading: true,
    notifyOnBackgroundError: (message) => toast.error(message),
    initialData:
      seed !== null &&
      page === seed.data.page &&
      (!clientReady || seedFresh) &&
      getShoutboxContextKeyPart(seed.context) ===
        getShoutboxContextKeyPart(activeScope)
        ? seed.data
        : undefined,
    initialDataUpdatedAt: 0
  })

  // First-handoff placeholder: while the ready-flipped API scope fetches its
  // first payload, the same user keeps the SSR text with game associations
  // cleared from BOTH the rows and the pinned slot, projected against the
  // current time like any other payload. It never enters the new key's cache
  // and is consumed by the first real result; a different uid or any later
  // scope switch gets the plain pending state instead.
  const handoffRef = useRef<{ scopeKey: string | null; done: boolean }>({
    scopeKey: null,
    done: false
  })
  const activeScopeKey = getShoutboxContextKeyPart(activeScope)
  useEffect(() => {
    if (clientReady && query.data !== undefined) {
      handoffRef.current.done = true
    }
  }, [clientReady, query.data])
  let handoffData: ShoutboxListResponse | undefined
  if (
    query.displayData === undefined &&
    seed !== null &&
    initialContext !== undefined &&
    seed.context.uid === activeScope.uid &&
    !handoffRef.current.done &&
    (handoffRef.current.scopeKey === null ||
      handoffRef.current.scopeKey === activeScopeKey)
  ) {
    handoffRef.current.scopeKey = activeScopeKey
    const cleared: ShoutboxListResponse = {
      ...seed.data,
      pinned: seed.data.pinned ? { ...seed.data.pinned, patch: null } : null,
      shoutboxes: seed.data.shoutboxes.map((row) => ({ ...row, patch: null }))
    }
    handoffData = (
      patchUniqueId
        ? projectShoutboxPatchListDisplay
        : projectShoutboxGlobalListDisplay
    )(cleared, Date.now())
  }

  const data = query.displayData ?? handoffData ?? null
  const loading = query.status === 'pending' && data === null
  // The error surface stays visible (with retry) even while handoff text is
  // shown; only a successful empty payload renders the empty state.
  const initialError =
    query.status === 'error' && query.displayData === undefined
      ? (query.error?.message ?? '')
      : ''

  // While the handoff placeholder is on screen the new key has no cached
  // payload, so the base hook cannot arm the real-boundary timer. Arm a
  // render-only one here: the pin still drops on time even if the first API
  // read failed into its cooldown. No cache writes, no fetch — the effect
  // ends with the handoff or a scope change.
  const [, setHandoffTick] = useState(0)
  const handoffCleanupMs = handoffData
    ? resolveShoutboxCleanupMs(handoffData)
    : null
  useEffect(() => {
    if (handoffCleanupMs === null) {
      return
    }
    return scheduleShoutboxDeadline(handoffCleanupMs, () =>
      setHandoffTick((tick) => tick + 1)
    )
  }, [handoffCleanupMs])

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
    if (next === page) {
      return
    }
    setPage(next)
  }

  const handlePublished = (_item: ShoutboxItem) => {
    publishModal.onClose()
    // A fresh message lands at the top of page 1: jump there so the author
    // can confirm it immediately. The publish form already invalidated the
    // public cache; the key switch (or the write-path refetch when page 1 is
    // already observed) brings the fresh page in through the gate.
    setPage(1)
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

  const rows = useMemo(() => data?.shoutboxes ?? [], [data])
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

      {initialError !== '' && (
        <Alert
          color="danger"
          variant="flat"
          description={initialError}
          endContent={
            <Button
              size="sm"
              variant="light"
              color="danger"
              onPress={query.refresh}
            >
              重试
            </Button>
          }
        />
      )}

      {/* First-load failure renders only the error alert above (with retry);
          a real empty SUCCESS payload is the only path to the empty state. */}
      {loading ? (
        <div className="flex size-full items-center justify-center">
          <Spinner
            variant="default"
            size="md"
            color="primary"
            label="正在获取小喇叭..."
          />
        </div>
      ) : data === null ? null : !rows.length && !data?.pinned ? (
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
            />
          )}
          {rows.map((item) => (
            <ShoutboxCard
              key={item.id}
              item={item}
              compact
              highlight={highlightId === item.id}
              currentUserId={currentUserId}
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
            isLoading={query.fetchStatus === 'fetching'}
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
