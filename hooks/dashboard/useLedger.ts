'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { kunFetchGet } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import type { MoemoepointLedgerResponse } from '~/types/api/moemoepoint'
import {
  MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS,
  formatShanghaiCalendarDate,
  getMoemoepointRangeDays,
  isValidMoemoepointDate,
  type MoemoepointRangePreset
} from '~/utils/moemoepointDateRange'

export const LEDGER_LIMIT_OPTIONS: number[] = [30, 50, 100]

const PAGE_MAX = 9999999
const LIMIT_MAX = 100
const DEFAULT_LIMIT = 30

export type LedgerStatus = 'awaiting' | 'loading' | 'error' | 'ready'

export interface LedgerAppliedQuery {
  preset: MoemoepointRangePreset
  page: number
  limit: number
  /** 已提交到 URL 的自定义日期（仅 range=custom 时有意义） */
  start: string | null
  end: string | null
}

const toPositiveInt = (raw: string | null, fallback: number, max: number) => {
  if (!raw || !/^\d+$/.test(raw)) {
    return fallback
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 && value <= max
    ? value
    : fallback
}

const toPreset = (raw: string | null): MoemoepointRangePreset =>
  raw === '7d' || raw === '30d' || raw === 'custom' ? raw : '30d'

/** 已提交的自定义范围是否可直接查询（合法日历日期、顺序正确、1..90 天） */
export const isValidCommittedCustomRange = (
  start: string | null,
  end: string | null
) => {
  if (
    !start ||
    !end ||
    !isValidMoemoepointDate(start) ||
    !isValidMoemoepointDate(end)
  ) {
    return false
  }
  const days = getMoemoepointRangeDays(start, end)
  return days !== null && days >= 1 && days <= MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS
}

/** 请求指纹：用户 + 已应用查询；响应/错误只在指纹一致时展示，杜绝旧数据 */
const signatureOf = (userId: number, q: LedgerAppliedQuery) =>
  [userId, q.preset, q.start ?? '', q.end ?? '', q.page, q.limit].join('|')

export const useLedger = ({
  userId,
  currentUserId
}: {
  userId: number
  currentUserId: number
}) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // URL 是唯一已应用状态来源；非法 preset/page/limit 归一化为 30d/1/30
  const query = useMemo<LedgerAppliedQuery>(
    () => ({
      preset: toPreset(searchParams.get('range')),
      page: toPositiveInt(searchParams.get('page'), 1, PAGE_MAX),
      limit: toPositiveInt(searchParams.get('limit'), DEFAULT_LIMIT, LIMIT_MAX),
      start: searchParams.get('start'),
      end: searchParams.get('end')
    }),
    [searchParams]
  )

  const customReady =
    query.preset === 'custom' &&
    isValidCommittedCustomRange(query.start, query.end)
  const signature = signatureOf(userId, query)

  // 自定义日期草稿：未点“查询”不产生任何请求
  const [draftStart, setDraftStartState] = useState(() => {
    const raw = searchParams.get('start')
    return raw && isValidMoemoepointDate(raw) ? raw : ''
  })
  const [draftEnd, setDraftEndState] = useState(() => {
    const raw = searchParams.get('end')
    return raw && isValidMoemoepointDate(raw) ? raw : ''
  })
  const [draftsTouched, setDraftsTouched] = useState(false)
  const [draftError, setDraftError] = useState('')
  const lastCustomRef = useRef<{ start: string; end: string } | null>(null)

  // 已应用签名（含 page/limit/userId）变化且 URL 带完整自定义日期时回填草稿并复位
  // touched/error：深链 / 前进后退 / 换页后合法已提交日期可直接查询，无需再点一次。
  // 仅本地输入不改变 URL 签名，因此正在键入的草稿不会被覆盖
  useEffect(() => {
    if (query.preset === 'custom' && query.start && query.end) {
      setDraftStartState(isValidMoemoepointDate(query.start) ? query.start : '')
      setDraftEndState(isValidMoemoepointDate(query.end) ? query.end : '')
      setDraftsTouched(false)
      setDraftError('')
      if (isValidCommittedCustomRange(query.start, query.end)) {
        lastCustomRef.current = { start: query.start, end: query.end }
      }
    }
  }, [signature, query.preset, query.start, query.end])

  const setDraftStart = useCallback((value: string) => {
    setDraftStartState(value)
    setDraftsTouched(true)
    setDraftError('')
  }, [])
  const setDraftEnd = useCallback((value: string) => {
    setDraftEndState(value)
    setDraftsTouched(true)
    setDraftError('')
  }, [])

  const draftsDirty =
    draftsTouched &&
    (draftStart !== (query.start ?? '') || draftEnd !== (query.end ?? ''))
  const awaiting = query.preset === 'custom' && (!customReady || draftsDirty)

  const [result, setResult] = useState<{
    signature: string
    data: MoemoepointLedgerResponse
  } | null>(null)
  const [error, setError] = useState<{
    signature: string
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 已应用签名变化即丢弃旧结果/旧错误，A->B->A 不会在新请求返回前复活旧 A；
  // 同签名（含重试、发放后刷新）保留现有数据继续展示
  useEffect(() => {
    setResult((prev) => (prev && prev.signature === signature ? prev : null))
    setError((prev) => (prev && prev.signature === signature ? prev : null))
  }, [signature])

  useEffect(() => {
    if (query.preset === 'custom' && !customReady) {
      // 等待提交日期，绝不发请求
      setLoading(false)
      return
    }

    const requestId = ++requestIdRef.current
    const currentSignature = signature
    let cancelled = false
    setLoading(true)
    setError(null)

    const params: Record<string, string> = {
      range: query.preset,
      page: String(query.page),
      limit: String(query.limit)
    }
    if (query.preset === 'custom' && query.start && query.end) {
      params.start = query.start
      params.end = query.end
    }

    kunFetchGet<MoemoepointLedgerResponse | string>(
      `/user/${userId}/moemoepoint/ledger`,
      params
    )
      .then((response) => {
        if (
          cancelled ||
          requestId !== requestIdRef.current ||
          !mountedRef.current
        ) {
          return
        }
        if (typeof response === 'string') {
          setResult(null)
          setError({
            signature: currentSignature,
            message: response || '请求失败，请稍后重试'
          })
          return
        }
        setResult({ signature: currentSignature, data: response })

        // 仅当查看的是登录者本人账本时同步本地余额（total/reserved/available 一体更新）；
        // 查看他人账户绝不写本地状态
        const store = useUserStore.getState()
        if (store.user.uid === userId && userId === currentUserId) {
          store.setMoemoepointBalance(response.balance)
        }
      })
      .catch(() => {
        if (
          cancelled ||
          requestId !== requestIdRef.current ||
          !mountedRef.current
        ) {
          return
        }
        setResult(null)
        setError({
          signature: currentSignature,
          message: '网络异常，请检查网络连接后重试'
        })
      })
      .finally(() => {
        if (
          cancelled ||
          requestId !== requestIdRef.current ||
          !mountedRef.current
        ) {
          return
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    userId,
    currentUserId,
    customReady,
    signature,
    query.preset,
    query.page,
    query.limit,
    query.start,
    query.end,
    reloadToken
  ])

  // 只展示与当前已应用查询指纹一致的数据/错误
  const data = result && result.signature === signature ? result.data : null
  const errorMessage =
    error && error.signature === signature ? error.message : ''
  const status: LedgerStatus = awaiting
    ? 'awaiting'
    : errorMessage
      ? 'error'
      : data
        ? 'ready'
        : 'loading'

  const navigate = useCallback(
    (next: LedgerAppliedQuery) => {
      const params = new URLSearchParams()
      params.set('range', next.preset)
      if (next.preset === 'custom' && next.start && next.end) {
        params.set('start', next.start)
        params.set('end', next.end)
      }
      params.set('page', String(next.page))
      params.set('limit', String(next.limit))
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router]
  )

  // 7d/30d 立即切换并查询；进入 custom 不带日期 => 停留“请选择日期并查询”，
  // 并回填本会话上次已提交的自定义日期（仍需点击查询）
  const selectPreset = useCallback(
    (preset: MoemoepointRangePreset) => {
      if (preset === query.preset) {
        return
      }
      setDraftError('')
      if (
        preset === 'custom' &&
        !draftStart &&
        !draftEnd &&
        lastCustomRef.current
      ) {
        setDraftStartState(lastCustomRef.current.start)
        setDraftEndState(lastCustomRef.current.end)
      }
      navigate({ preset, page: 1, limit: query.limit, start: null, end: null })
    },
    [query.preset, query.limit, draftStart, draftEnd, navigate]
  )

  // 显式“查询”才把草稿提交进 URL（page 重置为 1）
  const applyCustom = useCallback(() => {
    if (!draftStart || !draftEnd) {
      setDraftError('请选择开始日期和结束日期')
      return
    }
    if (
      !isValidMoemoepointDate(draftStart) ||
      !isValidMoemoepointDate(draftEnd)
    ) {
      setDraftError('日期格式不正确')
      return
    }
    const today = formatShanghaiCalendarDate(new Date())
    if (draftStart > today || draftEnd > today) {
      setDraftError('日期不能晚于今天')
      return
    }
    const days = getMoemoepointRangeDays(draftStart, draftEnd)
    if (days === null) {
      setDraftError('日期格式不正确')
      return
    }
    if (days < 1) {
      setDraftError('开始日期不能晚于结束日期')
      return
    }
    if (days > MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS) {
      setDraftError(
        `自定义日期范围最长为 ${MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS} 天`
      )
      return
    }
    setDraftError('')
    navigate({
      preset: 'custom',
      start: draftStart,
      end: draftEnd,
      page: 1,
      limit: query.limit
    })
  }, [draftStart, draftEnd, query.limit, navigate])

  // 翻页 / 每页条数始终基于 URL 中已提交日期，绝不使用未保存草稿
  const goToPage = useCallback(
    (page: number) => {
      if (awaiting || page < 1) {
        return
      }
      navigate({ ...query, page })
    },
    [awaiting, query, navigate]
  )
  const changeLimit = useCallback(
    (limit: number) => {
      if (awaiting || limit === query.limit) {
        return
      }
      navigate({ ...query, page: 1, limit })
    },
    [awaiting, query, navigate]
  )

  // 失败重试 / 发放后刷新：以当前已应用查询重发，不重置任何筛选
  const retry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const today = useMemo(() => formatShanghaiCalendarDate(new Date()), [])

  return {
    status,
    awaiting,
    loading,
    errorMessage,
    data,
    query,
    today,
    draftStart,
    draftEnd,
    draftError,
    setDraftStart,
    setDraftEnd,
    selectPreset,
    applyCustom,
    goToPage,
    changeLimit,
    retry
  }
}
