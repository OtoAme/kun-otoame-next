'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'

import { kunFetchGet } from '~/utils/kunFetch'
import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'
import { resolveAdminSubmissionQueuePage } from '~/components/admin/submission/queueParams'
import {
  PATCH_SUBMISSION_LIST_PAGE_MAX,
  PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH
} from '~/constants/patchSubmission'
import { INBOX_KINDS } from '~/types/api/inbox'
import type {
  InboxItem,
  InboxItemResponse,
  InboxKind,
  InboxListResponse,
  InboxOrder
} from '~/types/api/inbox'
import {
  PATCH_SUBMISSION_STATUSES,
  type PatchSubmissionStatus
} from '~/types/api/patchSubmission'

export const INBOX_LIMIT_PER_KIND = 50
export const INBOX_SEARCH_MAX = 300
export const PG_INT_MAX = 2147483647
/** History mode pages one non-pending submission status at a time with the legacy page size. */
export const INBOX_HISTORY_LIMIT = 50

/** Status filter order mirrors the legacy submission list. */
export const INBOX_SUBMISSION_STATUSES: PatchSubmissionStatus[] = [
  'pending',
  'draft',
  'changes_requested',
  'rejected',
  'published',
  'violation',
  'deleted'
]

export const INBOX_SUBMISSION_STATUS_LABELS: Record<
  PatchSubmissionStatus,
  string
> = {
  pending: '待审核',
  draft: '草稿',
  changes_requested: '要求修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

export interface InboxSelection {
  kind: InboxKind
  id: number
}

export type InboxSelectionParse =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; selection: InboxSelection }

/** Fetched detail keyed by the exact request key so stale content is never rendered under a new selection. */
export interface InboxItemState {
  key: string
  data: InboxItemResponse
}

export interface UseInboxOptions {
  /** Shell-owned counts refresher; invoked after successful processing only. */
  refreshCounts: () => Promise<void>
}

export interface UseInboxReturn {
  kinds: InboxKind[]
  search: string
  order: InboxOrder
  /** True only when the submission source stands alone; the status filter shows then. */
  submissionOnly: boolean
  /** Parsed status filter; 'pending' (or any invalid value) keeps the unified queue. */
  submissionStatus: PatchSubmissionStatus
  /** Parsed 1-based history page; meaningful only in history mode. */
  submissionPage: number
  /** True when the list reads one non-pending submission status instead of the pending queue. */
  historyMode: boolean
  selectionStatus: InboxSelectionParse['status']
  selection: InboxSelection | null
  selectedKey: string | null
  items: InboxItem[]
  totals: Record<InboxKind, number> | null
  truncated: Record<InboxKind, boolean> | null
  /** True while the current query has no matching data yet, or a fetch is in flight. */
  listLoading: boolean
  /** Error belonging to the current query only; '' otherwise. */
  listError: string
  item: InboxItemState | null
  itemLoading: boolean
  /** Error belonging to the current selection only; '' otherwise. */
  itemError: string
  refreshing: boolean
  /** Live mirror of the actually displayed (current-query) rows for keyboard cursor / neighbor math. */
  itemsRef: React.MutableRefObject<InboxItem[]>
  selectItem: (item: InboxItem) => void
  clearSelection: () => void
  toggleKind: (kind: InboxKind, checked: boolean) => void
  setOrder: (order: InboxOrder) => void
  /** Switching status always resets the page and clears the selection. */
  setSubmissionStatus: (status: PatchSubmissionStatus) => void
  setSubmissionPage: (page: number) => void
  submitSearch: (value: string) => void
  retryList: () => void
  retryItem: () => void
  refreshAll: () => Promise<void>
  /** Called by InboxDetail only after API success for the exact captured key. */
  onProcessed: (key: string) => void
  /** Refreshes a conflicted item; history also reloads its current filtered list. */
  onStateChanged: (key: string) => Promise<void>
}

const KIND_SET: ReadonlySet<string> = new Set(INBOX_KINDS)
const EMPTY_ITEMS: InboxItem[] = []
const ID_PATTERN = /^[1-9]\d*$/

function parseId(raw: string): number | null {
  if (!ID_PATTERN.test(raw)) return null // no leading zeros, digits only
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id < 1 || id > PG_INT_MAX) return null
  return id
}

function parseKinds(raw: string | null): InboxKind[] {
  if (!raw) return [...INBOX_KINDS]
  const valid = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is InboxKind => KIND_SET.has(s))
  const unique = Array.from(new Set(valid))
  if (unique.length === 0) return [...INBOX_KINDS]
  return INBOX_KINDS.filter((k) => unique.includes(k))
}

function parseSearch(raw: string | null): string {
  return (raw ?? '').trim().slice(0, INBOX_SEARCH_MAX)
}

const SUBMISSION_STATUS_SET: ReadonlySet<string> = new Set(
  PATCH_SUBMISSION_STATUSES
)

/** Anything unreadable falls back to pending, i.e. the unified queue. */
function parseSubmissionStatus(raw: string | null): PatchSubmissionStatus {
  return raw !== null && SUBMISSION_STATUS_SET.has(raw)
    ? (raw as PatchSubmissionStatus)
    : 'pending'
}

/** Same bounds as the legacy submission list; anything else is page 1. */
function parseSubmissionPage(raw: string | null): number {
  if (raw === null) return 1
  const page = Number(raw)
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > PATCH_SUBMISSION_LIST_PAGE_MAX
  ) {
    return 1
  }
  return page
}

function parseSelection(
  kindRaw: string | null,
  idRaw: string | null
): InboxSelectionParse {
  if (kindRaw == null && idRaw == null) return { status: 'none' }
  if (!kindRaw || !idRaw || !KIND_SET.has(kindRaw)) return { status: 'invalid' }
  const id = parseId(idRaw)
  if (id === null) return { status: 'invalid' }
  return { status: 'ok', selection: { kind: kindRaw as InboxKind, id } }
}

function parseKey(key: string): InboxSelection | null {
  const idx = key.indexOf(':')
  if (idx <= 0) return null
  const kind = key.slice(0, idx)
  if (!KIND_SET.has(kind)) return null
  const id = parseId(key.slice(idx + 1))
  if (id === null) return null
  return { kind: kind as InboxKind, id }
}

export function selectionToKey(sel: InboxSelection): string {
  return `${sel.kind}:${sel.id}`
}

/** Existing GET /admin/patch-submission list payload (legacy history endpoint). */
interface AdminSubmissionHistoryResponse {
  submissions: AdminSubmissionRow[]
  total: number
}

/**
 * Adapts a history row to the inbox item shape. The row is a real current-state
 * record, not a read-only legacy pointer: readOnly stays false and the payload
 * carries the actual status so list and detail can render it directly.
 */
function historyRowToInboxItem(row: AdminSubmissionRow): InboxItem {
  return {
    key: `submission:${row.id}`,
    kind: 'submission',
    id: row.id,
    title: row.name,
    subtitle: row.authorName,
    actor: { id: row.authorId, name: row.authorName },
    waitingFrom: row.updated,
    waitingSeconds: 0,
    targetHref: `/admin/submission/${row.id}`,
    badges: [],
    readOnly: false,
    payload: row
  }
}

interface ListState {
  queryKey: string
  data: InboxListResponse
}

export function useInbox({ refreshCounts }: UseInboxOptions): UseInboxReturn {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const kinds = React.useMemo(
    () => parseKinds(searchParams.get('kinds')),
    [searchParams]
  )
  const search = React.useMemo(
    () => parseSearch(searchParams.get('search')),
    [searchParams]
  )
  const order: InboxOrder =
    searchParams.get('order') === 'kind' ? 'kind' : 'waiting'
  const submissionStatus = React.useMemo(
    () => parseSubmissionStatus(searchParams.get('submissionStatus')),
    [searchParams]
  )
  const submissionPage = React.useMemo(
    () => parseSubmissionPage(searchParams.get('submissionPage')),
    [searchParams]
  )
  const selectionParse = React.useMemo(
    () => parseSelection(searchParams.get('kind'), searchParams.get('id')),
    [searchParams]
  )
  const selectionStatus = selectionParse.status
  const selection =
    selectionParse.status === 'ok' ? selectionParse.selection : null
  const selectedKey = selection ? selectionToKey(selection) : null
  const kindsKey = kinds.join(',')
  // History mode exists only when the submission source stands alone; every other
  // source combination is always the unified pending queue, whatever the URL says.
  const submissionOnly = kinds.length === 1 && kinds[0] === 'submission'
  const historyMode = submissionOnly && submissionStatus !== 'pending'
  const effectiveStatus = historyMode ? submissionStatus : 'pending'
  const effectivePage = historyMode ? submissionPage : 1
  // The legacy history endpoint matches a shorter query than the pending queue: in
  // history mode the effective search is normalized to its limit, so the URL state,
  // the query identity, the input and the actual request all agree (never a silent
  // request-only truncation). Pending keeps the full INBOX_SEARCH_MAX.
  const effectiveSearch = historyMode
    ? search.slice(0, PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH)
    : search
  const currentQueryKey = JSON.stringify([
    kindsKey,
    effectiveSearch,
    order,
    effectiveStatus,
    effectivePage
  ])

  // Mounted + generation guards. Declared first so StrictMode re-setup runs before fetch effects.
  const mountedRef = React.useRef(true)
  const listGenRef = React.useRef(0)
  const itemGenRef = React.useRef(0)
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      listGenRef.current += 1
      itemGenRef.current += 1
    }
  }, [])

  // Bounded tombstones: keys confirmed non-pending by a just-completed action. They exist ONLY
  // to filter list responses from requests that were already in flight before the action (the
  // 409 path issues no full-list GET, so generation alone cannot invalidate those). Every new
  // authoritative list request clears the set at START — its response is fresh server truth,
  // and a resubmitted row reusing the SAME id is genuinely pending again, not stale.
  const removedKeysRef = React.useRef(new Set<string>())

  // Per-item-key request tokens for onStateChanged: a refresh is superseded only by a NEWER
  // request of the same key — either another state refresh, or a direct fetchItem of that key
  // (which deletes the pending token at start). Unrelated keys never invalidate each other.
  const stateReqCounterRef = React.useRef(0)
  const stateReqRef = React.useRef(new Map<string, number>())

  // Single ref with the latest URL-derived state; stable callbacks read from it so a
  // child-held callback (e.g. onProcessed) never re-applies stale filters on navigation.
  const stateRef = React.useRef({
    kinds,
    kindsKey,
    search: effectiveSearch,
    order,
    selection,
    pathname,
    submissionStatus,
    submissionPage,
    historyMode
  })
  stateRef.current = {
    kinds,
    kindsKey,
    search: effectiveSearch,
    order,
    selection,
    pathname,
    submissionStatus,
    submissionPage,
    historyMode
  }
  const selectedKeyRef = React.useRef<string | null>(null)
  selectedKeyRef.current = selectedKey
  const itemsRef = React.useRef<InboxItem[]>(EMPTY_ITEMS)

  const [listState, setListState] = React.useState<ListState | null>(null)
  const [listLoading, setListLoading] = React.useState(false)
  const [listErrorState, setListErrorState] = React.useState<{
    queryKey: string
    message: string
  } | null>(null)

  const fetchList = React.useCallback(async () => {
    if (!mountedRef.current) return
    const gen = ++listGenRef.current
    removedKeysRef.current.clear() // this request is post-action; its response is authoritative
    const {
      kindsKey: kk,
      search: s,
      order: o,
      historyMode: hm,
      submissionStatus: st,
      submissionPage: pg
    } = stateRef.current
    const queryKey = JSON.stringify([
      kk,
      s,
      o,
      hm ? st : 'pending',
      hm ? pg : 1
    ])
    setListLoading(true)
    setListErrorState(null)
    try {
      if (hm) {
        // History mode reuses the existing admin submission list endpoint exactly as the
        // legacy page did: one status per request, 50 rows per page, server-side matching
        // against title / author / external ID. No new endpoint or permission is added.
        const res = await kunFetchGet<AdminSubmissionHistoryResponse | string>(
          '/admin/patch-submission',
          {
            status: st,
            // s is the effective search, already normalized to the legacy query limit.
            query: s,
            page: pg,
            limit: INBOX_HISTORY_LIMIT
          }
        )
        if (!mountedRef.current || gen !== listGenRef.current) return
        if (typeof res === 'string') {
          setListErrorState({ queryKey, message: res || '加载列表失败' })
        } else {
          setListState({
            queryKey,
            data: {
              items: res.submissions.map(historyRowToInboxItem),
              totals: {
                submission: res.total,
                'resource-apply': 0,
                feedback: 0,
                report: 0
              },
              truncated: {
                submission: false,
                'resource-apply': false,
                feedback: false,
                report: false
              }
            }
          })
        }
        return
      }
      const res = await kunFetchGet<InboxListResponse | string>(
        '/admin/inbox',
        {
          kinds: kk,
          search: s,
          order: o,
          limitPerKind: INBOX_LIMIT_PER_KIND
        }
      )
      if (!mountedRef.current || gen !== listGenRef.current) return
      if (typeof res === 'string') {
        setListErrorState({ queryKey, message: res || '加载列表失败' })
      } else {
        let data = res
        const removed = removedKeysRef.current
        if (removed.size > 0) {
          // Pre-action in-flight response: drop rows confirmed removed after it started and
          // decrement only the totals of rows actually present in (and filtered from) THIS
          // response. Fresh requests cleared the set above, so this never hides resubmits.
          const filteredOut = res.items.filter((i) => removed.has(i.key))
          if (filteredOut.length > 0) {
            const totals = { ...res.totals }
            for (const it of filteredOut) {
              totals[it.kind] = Math.max(0, (totals[it.kind] ?? 0) - 1)
            }
            data = {
              ...res,
              items: res.items.filter((i) => !removed.has(i.key)),
              totals
            }
          }
        }
        setListState({ queryKey, data })
      }
    } catch {
      if (!mountedRef.current || gen !== listGenRef.current) return
      setListErrorState({ queryKey, message: '网络错误，列表加载失败，请重试' })
    } finally {
      if (mountedRef.current && gen === listGenRef.current)
        setListLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void fetchList()
  }, [
    kindsKey,
    effectiveSearch,
    order,
    effectiveStatus,
    effectivePage,
    fetchList
  ])

  const [item, setItem] = React.useState<InboxItemState | null>(null)
  const [itemLoading, setItemLoading] = React.useState(false)
  const [itemErrorState, setItemErrorState] = React.useState<{
    key: string
    message: string
  } | null>(null)

  const fetchItem = React.useCallback(async (sel: InboxSelection) => {
    if (!mountedRef.current) return
    const key = selectionToKey(sel)
    const gen = ++itemGenRef.current
    // A newer direct read of THIS key supersedes any pending state refresh for the same key:
    // its (older) outcome must not apply stale list removal/tombstone/error afterwards.
    // Only this key's token is dropped; unrelated items' pending refreshes stay valid.
    stateReqRef.current.delete(key)
    setItem(null) // never show the previous item's content under a new selection
    setItemErrorState(null)
    setItemLoading(true)
    try {
      const res = await kunFetchGet<InboxItemResponse | string>(
        '/admin/inbox/item',
        {
          kind: sel.kind,
          id: sel.id
        }
      )
      if (!mountedRef.current || gen !== itemGenRef.current) return
      if (typeof res === 'string') {
        setItemErrorState({ key, message: res || '加载详情失败' })
      } else {
        setItem({ key, data: res })
      }
    } catch {
      if (!mountedRef.current || gen !== itemGenRef.current) return
      setItemErrorState({ key, message: '网络错误，详情加载失败，请重试' })
    } finally {
      if (mountedRef.current && gen === itemGenRef.current)
        setItemLoading(false)
    }
  }, [])

  // Identifies the history query surrounding a same-key selection: changing the history
  // status/search/page (Select, hand-edited URL, back/forward) while the selection key
  // stays the same invalidates the standing detail request and refetches, so a detail
  // fetched under the old filter can never win under the new one. Pending filter changes
  // keep their original behavior (constant empty key, no extra refetch).
  const historyKey = historyMode
    ? `${submissionStatus}:${submissionPage}:${effectiveSearch}`
    : ''

  React.useEffect(() => {
    const sel = stateRef.current.selection
    if (selectionStatus !== 'ok' || !sel) {
      itemGenRef.current += 1 // invalid selection never reaches the endpoint
      setItem(null)
      setItemErrorState(null)
      setItemLoading(false)
      return
    }
    void fetchItem(sel)
  }, [selectedKey, selectionStatus, historyKey, fetchItem])

  const navigate = React.useCallback(
    (
      patch: {
        kinds?: InboxKind[]
        search?: string
        order?: InboxOrder
        selection?: InboxSelection | null
        submissionStatus?: PatchSubmissionStatus
        submissionPage?: number
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      const cur = stateRef.current
      const next = {
        kinds: patch.kinds ?? cur.kinds,
        search: patch.search ?? cur.search,
        order: patch.order ?? cur.order,
        selection:
          patch.selection === undefined ? cur.selection : patch.selection,
        submissionStatus: patch.submissionStatus ?? cur.submissionStatus,
        submissionPage: patch.submissionPage ?? cur.submissionPage
      }
      // History params are written only while the submission source stands alone with a
      // non-pending status; every other combination drops them so a stale or hand-edited
      // link can never mix history state into the multi-source pending queue.
      const nextSubmissionOnly =
        next.kinds.length === 1 && next.kinds[0] === 'submission'
      const nextHistory =
        nextSubmissionOnly && next.submissionStatus !== 'pending'
      const q = new URLSearchParams()
      q.set('kinds', next.kinds.join(','))
      // Persist only the search the history endpoint would actually run, so the URL
      // never advertises a longer query than the one executed (pending stays full).
      const nextSearch = nextHistory
        ? next.search.slice(0, PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH)
        : next.search
      if (nextSearch) q.set('search', nextSearch)
      if (next.order !== 'waiting') q.set('order', next.order)
      if (nextHistory) {
        q.set('submissionStatus', next.submissionStatus)
        if (next.submissionPage > 1)
          q.set('submissionPage', String(next.submissionPage))
      }
      if (next.selection) {
        q.set('kind', next.selection.kind)
        q.set('id', String(next.selection.id))
      }
      const href = `${cur.pathname || '/dashboard/inbox'}?${q.toString()}`
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [router]
  )

  // Legacy out-of-range / empty-tail rule, applied only to the response that matches the
  // standing history query (list data is keyed, so stale responses never navigate): a
  // page that no longer exists — hand-edited URL, or a tail page whose last rows were
  // reviewed elsewhere while its count lagged — is replaced by the resolved page. The
  // helper only ever steps back (empty page > 1 → min(lastPage, page-1), otherwise
  // min(page, lastPage)) and never leaves page 1; kinds/search/order/selection are
  // preserved by navigate, and the navigation starts the resolved page's fetch.
  React.useEffect(() => {
    if (!historyMode) return
    if (!listState || listState.queryKey !== currentQueryKey) return
    const resolvedPage = resolveAdminSubmissionQueuePage(
      submissionPage,
      listState.data.totals.submission,
      INBOX_HISTORY_LIMIT,
      listState.data.items.length
    )
    if (resolvedPage !== submissionPage)
      navigate({ submissionPage: resolvedPage }, 'replace')
  }, [historyMode, listState, currentQueryKey, submissionPage, navigate])

  const selectItem = React.useCallback(
    (it: InboxItem) => navigate({ selection: { kind: it.kind, id: it.id } }),
    [navigate]
  )
  const clearSelection = React.useCallback(
    () => navigate({ selection: null }),
    [navigate]
  )
  const toggleKind = React.useCallback(
    (kind: InboxKind, checked: boolean) => {
      const cur = stateRef.current.kinds
      const next = checked ? [...cur, kind] : cur.filter((k) => k !== kind)
      if (next.length === 0) return // at least one source must stay selected
      // Any source change leaves history mode: the queue always comes back to pending.
      navigate({
        kinds: INBOX_KINDS.filter((k) => next.includes(k)),
        submissionStatus: 'pending',
        submissionPage: 1
      })
    },
    [navigate]
  )
  const setOrder = React.useCallback(
    (o: InboxOrder) => navigate({ order: o }),
    [navigate]
  )
  const setSubmissionStatus = React.useCallback(
    (status: PatchSubmissionStatus) =>
      // A new status is a new list: page and selection from the old one never carry over.
      navigate({
        submissionStatus: status,
        submissionPage: 1,
        selection: null
      }),
    [navigate]
  )
  const setSubmissionPage = React.useCallback(
    (page: number) => {
      const clamped = Math.min(
        Math.max(1, Math.trunc(page)),
        PATCH_SUBMISSION_LIST_PAGE_MAX
      )
      navigate({ submissionPage: clamped })
    },
    [navigate]
  )
  const submitSearch = React.useCallback(
    (value: string) => {
      const search = value.trim().slice(0, INBOX_SEARCH_MAX)
      // In history mode a new search is a new result set: page and selection reset.
      if (stateRef.current.historyMode)
        navigate({ search, submissionPage: 1, selection: null })
      else navigate({ search })
    },
    [navigate]
  )

  const retryList = React.useCallback(() => void fetchList(), [fetchList])
  const retryItem = React.useCallback(() => {
    const sel = stateRef.current.selection
    if (sel) void fetchItem(sel)
  }, [fetchItem])

  const [refreshing, setRefreshing] = React.useState(false)
  const refreshAll = React.useCallback(async () => {
    if (!mountedRef.current) return
    setRefreshing(true)
    try {
      const sel = stateRef.current.selection
      await Promise.allSettled([
        fetchList(),
        sel ? fetchItem(sel) : Promise.resolve(),
        refreshCounts()
      ])
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [fetchList, fetchItem, refreshCounts])

  const onProcessed = React.useCallback(
    (key: string) => {
      if (!mountedRef.current) return
      const sel = parseKey(key)
      if (!sel) return
      // Advance selection only when the processed key is still the selected one.
      const items = itemsRef.current
      const idx = items.findIndex((i) => i.key === key)
      if (selectedKeyRef.current === key) {
        const next = idx >= 0 ? (items[idx + 1] ?? items[idx - 1]) : undefined
        navigate(
          { selection: next ? { kind: next.kind, id: next.id } : null },
          'replace'
        )
      }
      // A completed review is real pending-queue work no matter where the reviewer stands
      // when the callback fires (a request that started in pending may finish after an
      // in-flight switch to history): refresh the shell's pending counts exactly once.
      // History totals are never written into them.
      void refreshCounts()
      if (stateRef.current.historyMode) {
        // History rows are current-state records, not pending work: never tombstone or
        // locally remove them; the authoritative refetch applies any real status change.
        void fetchList()
        return
      }
      removedKeysRef.current.add(key)
      // Remove exactly that item and decrement its source total once; pure updater, no ref
      // side effects. The authoritative refetch below replaces this local adjustment.
      setListState((prev) => {
        if (!prev || !prev.data.items.some((i) => i.key === key)) return prev
        return {
          ...prev,
          data: {
            ...prev.data,
            items: prev.data.items.filter((i) => i.key !== key),
            totals: {
              ...prev.data.totals,
              [sel.kind]: Math.max(0, (prev.data.totals[sel.kind] ?? 0) - 1)
            }
          }
        }
      })
      void fetchList()
    },
    [navigate, refreshCounts, fetchList]
  )

  const onStateChanged = React.useCallback(
    async (key: string) => {
      if (!mountedRef.current) return
      const sel = parseKey(key)
      if (!sel) return
      const isVisible = selectedKeyRef.current === key
      // Register this refresh as the newest for THIS key only.
      const token = ++stateReqCounterRef.current
      stateReqRef.current.set(key, token)
      // Identity of the list query this refresh was issued under: its single-row outcome
      // may touch the list only while that exact query is still standing; a query that has
      // since changed is owned by its own authoritative fetch.
      const issuedQuery = stateRef.current
      const issuedListQueryKey = JSON.stringify([
        issuedQuery.kindsKey,
        issuedQuery.search,
        issuedQuery.order,
        issuedQuery.historyMode ? issuedQuery.submissionStatus : 'pending',
        issuedQuery.historyMode ? issuedQuery.submissionPage : 1
      ])
      // Visible item: invalidate any in-flight initial fetch of the same item (which could
      // still resolve stale 'pending') and take over its loading/error lifecycle so a spinner
      // orphaned by the invalidated fetch is always terminated here.
      const gen = isVisible ? ++itemGenRef.current : itemGenRef.current
      if (isVisible) {
        setItemLoading(true)
        setItemErrorState(null)
      }
      const finishVisibleError = (message: string) => {
        if (gen === itemGenRef.current && selectedKeyRef.current === key) {
          setItemErrorState({ key, message })
          setItemLoading(false)
        }
        // else: a newer request/selection owns the visible detail lifecycle now.
      }
      let res: InboxItemResponse | string
      try {
        res = await kunFetchGet<InboxItemResponse | string>(
          '/admin/inbox/item',
          {
            kind: sel.kind,
            id: sel.id
          }
        )
      } catch {
        if (!mountedRef.current) return
        const newest = stateReqRef.current.get(key) === token
        if (newest) stateReqRef.current.delete(key)
        if (!newest) return
        if (isVisible) finishVisibleError('网络错误，刷新事项失败，请重试')
        else toast.error('网络错误，刷新事项失败')
        return
      }
      if (!mountedRef.current) return
      const isNewest = stateReqRef.current.get(key) === token
      if (isNewest) stateReqRef.current.delete(key)
      if (typeof res === 'string') {
        if (!isNewest) return
        if (isVisible) finishVisibleError(res || '刷新事项失败')
        else toast.error(res || '刷新事项失败')
        return
      }
      // Superseded for this key — by a newer state refresh OR by a newer direct fetchItem of
      // the same key (which deleted this token): drop list removal, tombstone and detail/error
      // application entirely. The newer request's fresher result is the one that applies.
      if (!isNewest) return
      const now = stateRef.current
      const currentListQueryKey = JSON.stringify([
        now.kindsKey,
        now.search,
        now.order,
        now.historyMode ? now.submissionStatus : 'pending',
        now.historyMode ? now.submissionPage : 1
      ])
      if (now.historyMode) {
        if (currentListQueryKey === issuedListQueryKey) {
          // History membership is decided by the server-side status/query filter: a refreshed
          // row is never mapped/filtered in place — whatever its new state (pending,
          // processed or missing), its new status or edited name may no longer match the
          // standing filter. The authoritative refetch restores the real rows, order, total
          // and pagination of the CURRENT filter; the visible detail below still applies
          // this response's fresh truth. No tombstone: this is not pending-queue work.
          void fetchList()
        }
        // else: the history query moved on while this refresh was in flight — the navigation
        // already issued an authoritative fetch for it; this old-query outcome writes nothing.
      } else if (currentListQueryKey === issuedListQueryKey) {
        // Pending queue, same standing query: single-item list update only (no full-list
        // GET); map/filter keeps server order and never inserts an outside-window item.
        // Independent keys (A while viewing B) always apply. Only the pending queue
        // tombstones. A query that changed mid-flight is owned by its authoritative refetch.
        if (res.state !== 'pending') removedKeysRef.current.add(key)
        setListState((prev) => {
          if (!prev || !prev.data.items.some((i) => i.key === key)) return prev
          if (res.state === 'pending') {
            const refreshed = res.item
            return {
              ...prev,
              data: {
                ...prev.data,
                items: prev.data.items.map((i) =>
                  i.key === key ? refreshed : i
                )
              }
            }
          }
          return {
            ...prev,
            data: {
              ...prev.data,
              items: prev.data.items.filter((i) => i.key !== key),
              totals: {
                ...prev.data.totals,
                [sel.kind]: Math.max(0, (prev.data.totals[sel.kind] ?? 0) - 1)
              }
            }
          }
        })
      }
      // Visible detail updates only if the user is still on this item and no newer item
      // request (selection change / refresh / another state change) superseded this one.
      if (
        isVisible &&
        gen === itemGenRef.current &&
        selectedKeyRef.current === key
      ) {
        setItem({ key, data: res })
        setItemLoading(false)
      }
    },
    [fetchList]
  )

  // Expose only rows/errors that belong to the current query or selection; stale-keyed data
  // is hidden rather than relabeled. A failed refresh of the SAME query keeps its old rows
  // plus its keyed error.
  const listMatches =
    listState !== null && listState.queryKey === currentQueryKey
  const items = listMatches ? listState.data.items : EMPTY_ITEMS
  const totals = listMatches ? listState.data.totals : null
  const truncated = listMatches ? listState.data.truncated : null
  const listError =
    listErrorState && listErrorState.queryKey === currentQueryKey
      ? listErrorState.message
      : ''
  const itemError =
    itemErrorState && itemErrorState.key === selectedKey
      ? itemErrorState.message
      : ''
  const effectiveListLoading = listLoading || (!listMatches && !listError)
  itemsRef.current = items

  return {
    kinds,
    // The effective search: normalized to the legacy query limit in history mode so
    // the input mirrors the query that actually runs; pending keeps the raw value.
    search: effectiveSearch,
    order,
    submissionOnly,
    submissionStatus,
    submissionPage,
    historyMode,
    selectionStatus,
    selection,
    selectedKey,
    items,
    totals,
    truncated,
    listLoading: effectiveListLoading,
    listError,
    item,
    itemLoading,
    itemError,
    refreshing,
    itemsRef,
    selectItem,
    clearSelection,
    toggleKind,
    setOrder,
    setSubmissionStatus,
    setSubmissionPage,
    submitSearch,
    retryList,
    retryItem,
    refreshAll,
    onProcessed,
    onStateChanged
  }
}
