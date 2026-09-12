import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { kunFetchGet } from '~/utils/kunFetch'
import type { AdminShoutboxListResponse } from '~/types/api/shoutbox'

export const ADMIN_SHOUTBOX_TABS = [
  'official',
  'pending_review',
  'public',
  'removed'
] as const
export type AdminShoutboxTab = (typeof ADMIN_SHOUTBOX_TABS)[number]

export const ADMIN_SHOUTBOX_TAB_LABELS: Record<AdminShoutboxTab, string> = {
  official: '官方消息',
  pending_review: '待复核',
  public: '公开中',
  removed: '已终止'
}

const DEFAULT_TAB: AdminShoutboxTab = 'official'
const PAGE_SIZE = 20
const MAX_PAGE = 9999999
const FALLBACK_ERROR = '获取小喇叭列表失败，请稍后重试'
const NETWORK_ERROR = '网络错误，请检查网络连接后重试'

const parseTab = (raw: string | null): AdminShoutboxTab =>
  (ADMIN_SHOUTBOX_TABS as readonly string[]).includes(raw ?? '')
    ? (raw as AdminShoutboxTab)
    : DEFAULT_TAB

const parsePage = (raw: string | null): number => {
  if (raw === null || !/^\d+$/.test(raw)) {
    return 1
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PAGE
    ? value
    : 1
}

const parseShoutboxId = (raw: string | null): number | null => {
  if (raw === null || !/^\d+$/.test(raw)) {
    return null
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}

/**
 * Admin shoutbox list: four tabs (official / pending review / public /
 * removed) with the tab and page kept in the URL. Switching tabs resets to
 * page 1; responses are keyed so a stale tab's rows can never render under
 * the new one. A `shoutbox` id in the URL switches to a targeted view: the
 * server locates that single record in any status, the page is fixed to 1
 * and the query key carries the id, so switching targets or going back can
 * never render a stale response.
 */
export const useAdminShoutbox = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const query = useMemo(() => {
    const shoutboxId = parseShoutboxId(searchParams.get('shoutbox'))
    const tab = parseTab(searchParams.get('tab'))
    const page = shoutboxId === null ? parsePage(searchParams.get('page')) : 1
    return {
      tab,
      page,
      shoutboxId,
      key: shoutboxId === null ? `${tab}|${page}` : `shoutbox|${shoutboxId}`
    }
  }, [searchParams])

  const [data, setData] = useState<{
    key: string
    value: AdminShoutboxListResponse
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
    // Never render rows belonging to a different tab/page under the new key.
    setData((prev) => (prev !== null && prev.key !== query.key ? null : prev))
    kunFetchGet<AdminShoutboxListResponse | string>(
      '/admin/shoutbox',
      query.shoutboxId === null
        ? { tab: query.tab, page: query.page, limit: PAGE_SIZE }
        : { shoutboxId: query.shoutboxId, page: 1, limit: PAGE_SIZE }
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
        if (res && Array.isArray(res.shoutboxes)) {
          setData({ key: query.key, value: res })
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
    // query.key encodes tab|page (or the targeted id); depending on the
    // primitive keeps the effect from re-firing on a mere identity change
    // of the query object.
  }, [query.key, refreshNonce])

  const pushQuery = useCallback(
    (tab: AdminShoutboxTab, page: number) => {
      const params = new URLSearchParams()
      if (tab !== DEFAULT_TAB) {
        params.set('tab', tab)
      }
      if (page !== 1) {
        params.set('page', String(page))
      }
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router]
  )

  const setTab = useCallback(
    (tab: AdminShoutboxTab) => {
      if (tab === query.tab) return
      pushQuery(tab, 1)
    },
    [query.tab, pushQuery]
  )

  const setPage = useCallback(
    (page: number) => {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > MAX_PAGE ||
        page === query.page
      )
        return
      pushQuery(query.tab, page)
    },
    [query, pushQuery]
  )

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), [])

  // Leave the targeted view: pushQuery rebuilds the params from scratch, so
  // the shoutbox id is simply dropped and the plain tab list comes back.
  const backToList = useCallback(() => {
    pushQuery(query.tab, 1)
  }, [query.tab, pushQuery])

  const currentData =
    data !== null && data.key === query.key ? data.value : null
  const currentError =
    error !== null && error.key === query.key ? error.message : null

  return {
    query,
    items: currentData?.shoutboxes ?? [],
    page: currentData?.page ?? query.page,
    totalPages: currentData?.totalPages ?? 0,
    loading: currentData === null && currentError === null,
    refreshing: currentData !== null && loadingKey === query.key,
    error: currentError,
    refresh,
    setTab,
    setPage,
    backToList
  }
}
