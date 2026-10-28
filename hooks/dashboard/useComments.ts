import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { kunFetchGet } from '~/utils/kunFetch'
import type { AdminComment } from '~/types/api/admin'

export const COMMENT_PAGE_SIZE_OPTIONS = [30, 50, 100, 500] as const
export type CommentSearchType = 'content' | 'user'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 30
const MAX_PAGE = 9999999
const MAX_LIMIT = 500
const MAX_ID = 9999999
const MAX_SEARCH_LENGTH = 300
const FALLBACK_ERROR = '获取评论列表失败，请稍后重试'
const NETWORK_ERROR = '网络错误，请稍后重试'

export interface CommentsQuery {
  page: number
  limit: number
  searchType: CommentSearchType
  /** Content keyword; empty for user searches. */
  search: string
  /** Selected author for user searches. */
  userId: number | null
  userName: string
  /** Comment shown in the detail pane; kept in the URL so it survives reload. */
  selected: number | null
  /** Identity of the list request, excluding the selection. */
  key: string
}

type QueryTarget = Omit<CommentsQuery, 'key'>

const parseBoundedInt = (
  raw: string | null,
  fallback: number | null,
  max: number
): number | null => {
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 && value <= max
    ? value
    : fallback
}

const buildKey = (target: Omit<QueryTarget, 'selected'>) =>
  [
    target.page,
    target.limit,
    target.searchType,
    target.search,
    target.userId ?? ''
  ].join('|')

export const useComments = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const query = useMemo<CommentsQuery>(() => {
    const searchType: CommentSearchType =
      searchParams.get('searchType') === 'user' ? 'user' : 'content'
    const userId =
      searchType === 'user'
        ? parseBoundedInt(searchParams.get('userId'), null, MAX_ID)
        : null
    const target = {
      page:
        parseBoundedInt(searchParams.get('page'), DEFAULT_PAGE, MAX_PAGE) ??
        DEFAULT_PAGE,
      limit:
        parseBoundedInt(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT) ??
        DEFAULT_LIMIT,
      searchType,
      search:
        searchType === 'content'
          ? (searchParams.get('search') ?? '').slice(0, MAX_SEARCH_LENGTH)
          : '',
      userId,
      userName:
        userId === null ? '' : (searchParams.get('userName') ?? '').slice(0, 17)
    }
    return {
      ...target,
      selected: parseBoundedInt(searchParams.get('id'), null, MAX_ID),
      key: buildKey(target)
    }
  }, [searchParams])

  const [data, setData] = useState<{
    key: string
    comments: AdminComment[]
    total: number
  } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null
  )
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    let active = true
    setLoadingKey(query.key)
    setError(null)
    // Rows from another key never render under this request; a same-key
    // refresh keeps its rows while busy.
    setData((prev) => (prev !== null && prev.key !== query.key ? null : prev))
    const params: Record<string, string | number> = {
      page: query.page,
      limit: query.limit,
      searchType: query.searchType
    }
    if (query.search) params.search = query.search
    if (query.userId !== null) params.userId = query.userId
    Promise.resolve()
      .then(() =>
        kunFetchGet<{ comments: AdminComment[]; total: number } | string>(
          '/admin/comment',
          params
        )
      )
      .then((res) => {
        if (!active || seq !== requestSeq.current) return
        if (typeof res === 'string') {
          setData(null)
          setError({
            key: query.key,
            message: res.trim() === '' ? FALLBACK_ERROR : res
          })
          return
        }
        if (
          res &&
          Array.isArray(res.comments) &&
          typeof res.total === 'number'
        ) {
          setData({ key: query.key, comments: res.comments, total: res.total })
          return
        }
        setData(null)
        setError({ key: query.key, message: FALLBACK_ERROR })
      })
      .catch(() => {
        if (!active || seq !== requestSeq.current) return
        setData(null)
        setError({ key: query.key, message: NETWORK_ERROR })
      })
      .finally(() => {
        if (!active || seq !== requestSeq.current) return
        setLoadingKey(null)
      })
    return () => {
      active = false
    }
    // The selection is not part of the list request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.key, refreshNonce])

  const pushQuery = useCallback(
    (next: QueryTarget) => {
      const params = new URLSearchParams()
      params.set('page', String(next.page))
      params.set('limit', String(next.limit))
      params.set('searchType', next.searchType)
      if (next.searchType === 'content' && next.search) {
        params.set('search', next.search)
      }
      if (next.searchType === 'user' && next.userId !== null) {
        params.set('userId', String(next.userId))
        if (next.userName) params.set('userName', next.userName)
      }
      if (next.selected !== null) params.set('id', String(next.selected))
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router]
  )

  // Every list change drops the selection unless it says otherwise, so the
  // detail never shows a comment that left the visible rows.
  const update = useCallback(
    (patch: Partial<QueryTarget>) =>
      pushQuery({ ...query, selected: null, ...patch }),
    [query, pushQuery]
  )

  const currentData = data !== null && data.key === query.key ? data : null
  const currentError =
    error !== null && error.key === query.key ? error.message : null

  return {
    query,
    comments: currentData?.comments ?? [],
    total: currentData?.total ?? 0,
    loading: currentData === null && currentError === null,
    refreshing: currentData !== null && loadingKey === query.key,
    error: currentError,
    refresh: useCallback(() => setRefreshNonce((n) => n + 1), []),
    setPage: (page: number) => {
      if (Number.isInteger(page) && page >= 1 && page !== query.page) {
        update({ page })
      }
    },
    setLimit: (limit: number) => {
      if (limit !== query.limit) update({ page: DEFAULT_PAGE, limit })
    },
    setSearchType: (searchType: CommentSearchType) => {
      if (searchType !== query.searchType) {
        update({
          page: DEFAULT_PAGE,
          searchType,
          search: '',
          userId: null,
          userName: ''
        })
      }
    },
    commitSearch: (raw: string) => {
      const search = raw.trim().slice(0, MAX_SEARCH_LENGTH)
      if (search !== query.search) update({ page: DEFAULT_PAGE, search })
    },
    selectUser: (user: { id: number; name: string } | null) =>
      update({
        page: DEFAULT_PAGE,
        userId: user?.id ?? null,
        userName: user?.name ?? ''
      }),
    select: (id: number | null) => {
      if (id !== query.selected) pushQuery({ ...query, selected: id })
    },
    /** After deleting rows, step back a page if the current one empties. */
    notifyDeleted: (count: number) => {
      const remaining = Math.max(0, (currentData?.total ?? 0) - count)
      const lastPage = Math.max(1, Math.ceil(remaining / query.limit))
      if (query.page > lastPage) {
        update({ page: lastPage })
        return
      }
      if (query.selected !== null) pushQuery({ ...query, selected: null })
      setRefreshNonce((n) => n + 1)
    }
  }
}
