'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'

import { kunFetchGet } from '~/utils/kunFetch'
import { INBOX_KINDS } from '~/types/api/inbox'
import type {
  InboxItem,
  InboxItemResponse,
  InboxKind,
  InboxListResponse,
  InboxOrder
} from '~/types/api/inbox'

export const INBOX_LIMIT_PER_KIND = 50
export const INBOX_SEARCH_MAX = 300
export const PG_INT_MAX = 2147483647

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
  submitSearch: (value: string) => void
  retryList: () => void
  retryItem: () => void
  refreshAll: () => Promise<void>
  /** Called by InboxDetail only after API success for the exact captured key. */
  onProcessed: (key: string) => void
  /** Re-fetches only the affected item (e.g. after submission 409), never the whole list. */
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
  const selectionParse = React.useMemo(
    () => parseSelection(searchParams.get('kind'), searchParams.get('id')),
    [searchParams]
  )
  const selectionStatus = selectionParse.status
  const selection =
    selectionParse.status === 'ok' ? selectionParse.selection : null
  const selectedKey = selection ? selectionToKey(selection) : null
  const kindsKey = kinds.join(',')
  const currentQueryKey = JSON.stringify([kindsKey, search, order])

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
    search,
    order,
    selection,
    pathname
  })
  stateRef.current = { kinds, kindsKey, search, order, selection, pathname }
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
    const { kindsKey: kk, search: s, order: o } = stateRef.current
    const queryKey = JSON.stringify([kk, s, o])
    setListLoading(true)
    setListErrorState(null)
    try {
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
  }, [kindsKey, search, order, fetchList])

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
  }, [selectedKey, selectionStatus, fetchItem])

  const navigate = React.useCallback(
    (
      patch: {
        kinds?: InboxKind[]
        search?: string
        order?: InboxOrder
        selection?: InboxSelection | null
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      const cur = stateRef.current
      const next = {
        kinds: patch.kinds ?? cur.kinds,
        search: patch.search ?? cur.search,
        order: patch.order ?? cur.order,
        selection:
          patch.selection === undefined ? cur.selection : patch.selection
      }
      const q = new URLSearchParams()
      q.set('kinds', next.kinds.join(','))
      if (next.search) q.set('search', next.search)
      if (next.order !== 'waiting') q.set('order', next.order)
      if (next.selection) {
        q.set('kind', next.selection.kind)
        q.set('id', String(next.selection.id))
      }
      const href = `${cur.pathname || '/dashboard'}?${q.toString()}`
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [router]
  )

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
      navigate({ kinds: INBOX_KINDS.filter((k) => next.includes(k)) })
    },
    [navigate]
  )
  const setOrder = React.useCallback(
    (o: InboxOrder) => navigate({ order: o }),
    [navigate]
  )
  const submitSearch = React.useCallback(
    (value: string) =>
      navigate({ search: value.trim().slice(0, INBOX_SEARCH_MAX) }),
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
      void refreshCounts()
      void fetchList()
    },
    [navigate, refreshCounts, fetchList]
  )

  const onStateChanged = React.useCallback(async (key: string) => {
    if (!mountedRef.current) return
    const sel = parseKey(key)
    if (!sel) return
    const isVisible = selectedKeyRef.current === key
    // Register this refresh as the newest for THIS key only.
    const token = ++stateReqCounterRef.current
    stateReqRef.current.set(key, token)
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
      res = await kunFetchGet<InboxItemResponse | string>('/admin/inbox/item', {
        kind: sel.kind,
        id: sel.id
      })
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
    if (res.state !== 'pending') removedKeysRef.current.add(key)
    // Single-item list update only (no full-list GET); map/filter keeps server order and
    // never inserts an outside-window item. Independent keys (A while viewing B) always apply.
    setListState((prev) => {
      if (!prev || !prev.data.items.some((i) => i.key === key)) return prev
      if (res.state === 'pending') {
        const refreshed = res.item
        return {
          ...prev,
          data: {
            ...prev.data,
            items: prev.data.items.map((i) => (i.key === key ? refreshed : i))
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
  }, [])

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
    search,
    order,
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
    submitSearch,
    retryList,
    retryItem,
    refreshAll,
    onProcessed,
    onStateChanged
  }
}
