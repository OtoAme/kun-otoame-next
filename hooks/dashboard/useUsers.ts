import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { kunFetchGet } from '~/utils/kunFetch'
import type { AdminUser } from '~/types/api/admin'

export const USER_PAGE_SIZE_OPTIONS = [30, 50, 100, 500] as const
export type UserSearchType = 'name' | 'email' | 'id'

export const MAX_USER_PAGE = 9999999
export const MAX_USER_ID = 9999999
const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 500
const MAX_SEARCH_LENGTH = 300
const FALLBACK_ERROR = '获取用户列表失败，请稍后重试'
const NETWORK_ERROR = '网络错误，请稍后重试'

export interface UsersQuery {
  page: number
  limit: number
  search: string
  searchType: UserSearchType
  idSearchError: string | null
  key: string
}

interface QueryTarget {
  page: number
  limit: number
  search: string
  searchType: UserSearchType
}

const parseBoundedInt = (
  raw: string | null,
  fallback: number,
  max: number
): number => {
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 && value <= max
    ? value
    : fallback
}

const validateIdSearch = (search: string): string | null => {
  const trimmed = search.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return '用户 ID 仅支持数字，请检查输入'
  const normalized = trimmed.replace(/^0+/, '') || '0'
  if (normalized.length > 7 || Number(normalized) > MAX_USER_ID) {
    return `用户 ID 范围为 1-${MAX_USER_ID}`
  }
  return null
}

export const buildUsersQueryKey = (
  page: number,
  limit: number,
  searchType: UserSearchType,
  search: string
): string => [page, limit, searchType, search].join('|')

export const useUsers = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const query = useMemo<UsersQuery>(() => {
    const page = parseBoundedInt(
      searchParams.get('page'),
      DEFAULT_PAGE,
      MAX_USER_PAGE
    )
    const limit = parseBoundedInt(
      searchParams.get('limit'),
      DEFAULT_LIMIT,
      MAX_LIMIT
    )
    const search = (searchParams.get('search') ?? '').slice(
      0,
      MAX_SEARCH_LENGTH
    )
    const rawType = searchParams.get('searchType')
    const searchType: UserSearchType =
      rawType === 'email' || rawType === 'id' ? rawType : 'name'
    return {
      page,
      limit,
      search,
      searchType,
      idSearchError: searchType === 'id' ? validateIdSearch(search) : null,
      key: buildUsersQueryKey(page, limit, searchType, search)
    }
  }, [searchParams])

  const [data, setData] = useState<{
    key: string
    users: AdminUser[]
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
    if (query.idSearchError !== null) {
      setLoadingKey(null)
      return () => {
        active = false
      }
    }
    setLoadingKey(query.key)
    setError(null)
    // Drop rows owned by a different key so a reused key (A->B->A) can never
    // render stale rows under the new request; same-key refreshes keep their
    // data while busy and a failure still replaces data with a keyed error.
    setData((prev) => (prev !== null && prev.key !== query.key ? null : prev))
    Promise.resolve()
      .then(() =>
        kunFetchGet<{ users: AdminUser[]; total: number } | string>(
          '/admin/user',
          {
            page: query.page,
            limit: query.limit,
            search: query.search,
            searchType: query.searchType
          }
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
        if (res && Array.isArray(res.users) && typeof res.total === 'number') {
          setData({ key: query.key, users: res.users, total: res.total })
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
  }, [query, refreshNonce])

  const pushQuery = useCallback(
    (next: QueryTarget) => {
      const params = new URLSearchParams()
      params.set('page', String(next.page))
      params.set('limit', String(next.limit))
      params.set('search', next.search)
      params.set('searchType', next.searchType)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router]
  )

  const setPage = useCallback(
    (page: number) => {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > MAX_USER_PAGE ||
        page === query.page
      )
        return
      pushQuery({
        page,
        limit: query.limit,
        search: query.search,
        searchType: query.searchType
      })
    },
    [query, pushQuery]
  )

  const setLimit = useCallback(
    (limit: number) => {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_LIMIT ||
        limit === query.limit
      )
        return
      pushQuery({
        page: DEFAULT_PAGE,
        limit,
        search: query.search,
        searchType: query.searchType
      })
    },
    [query, pushQuery]
  )

  const setSearchType = useCallback(
    (searchType: UserSearchType) => {
      if (searchType === query.searchType) return
      pushQuery({
        page: DEFAULT_PAGE,
        limit: query.limit,
        search: query.search,
        searchType
      })
    },
    [query, pushQuery]
  )

  const commitSearch = useCallback(
    (raw: string) => {
      const search = raw.trim().slice(0, MAX_SEARCH_LENGTH)
      if (search === query.search) return
      pushQuery({
        page: DEFAULT_PAGE,
        limit: query.limit,
        search,
        searchType: query.searchType
      })
    },
    [query, pushQuery]
  )

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), [])

  const currentData = data !== null && data.key === query.key ? data : null
  const currentError =
    query.idSearchError === null && error !== null && error.key === query.key
      ? error.message
      : null

  // Always-current view of the committed query and its rows, so a dialog
  // callback resolving after a navigation acts on the live list and can
  // never resurrect a stale query capture.
  const latestRef = useRef({
    query,
    users: currentData?.users ?? [],
    total: currentData?.total ?? 0
  })
  useEffect(() => {
    latestRef.current = {
      query,
      users: currentData?.users ?? [],
      total: currentData?.total ?? 0
    }
  })

  const notifyUpdated = useCallback(
    (_uid?: number) => setRefreshNonce((n) => n + 1),
    []
  )

  const notifyDeleted = useCallback(
    (uid?: number) => {
      const {
        query: live,
        users: liveUsers,
        total: liveTotal
      } = latestRef.current
      const deletedInRows =
        uid !== undefined && liveUsers.some((user) => user.id === uid)
      if (deletedInRows) {
        const lastPage = Math.max(
          1,
          Math.ceil(Math.max(0, liveTotal - 1) / live.limit)
        )
        if (live.page > lastPage) {
          pushQuery({
            page: lastPage,
            limit: live.limit,
            search: live.search,
            searchType: live.searchType
          })
          return
        }
      }
      setRefreshNonce((n) => n + 1)
    },
    [pushQuery]
  )

  return {
    query,
    users: currentData?.users ?? [],
    total: currentData?.total ?? 0,
    loading:
      query.idSearchError === null &&
      currentData === null &&
      currentError === null,
    refreshing: currentData !== null && loadingKey === query.key,
    error: currentError,
    refresh,
    setPage,
    setLimit,
    setSearchType,
    commitSearch,
    notifyUpdated,
    notifyDeleted
  }
}
