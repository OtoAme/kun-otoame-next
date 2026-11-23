'use client'

import { useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import { GalgameCard } from './Card'
import { FilterBar } from './FilterBar'
import { useMounted } from '~/hooks/useMounted'
import { useBrowsingScope } from '~/hooks/useBrowsingScope'
import { Button } from '@heroui/button'
import { KunHeader } from '../kun/Header'
import { KunPagination } from '../kun/Pagination'
import type { SortField, SortOrder } from './_sort'
import { DEFAULT_GALGAME_MIN_RATING_COUNT } from '~/utils/galgameFilter'
import { KunLoading } from '../kun/Loading'

interface Props {
  initialGalgames: GalgameCard[]
  initialTotal: number
  initialVisibility?: 'pending' | 'show'
}

export const CardContainer = ({
  initialGalgames,
  initialTotal,
  initialVisibility = 'show'
}: Props) => {
  const isMounted = useMounted()
  const scope = useBrowsingScope()
  const scopeRef = useRef(scope.key)
  scopeRef.current = scope.key
  const requestIdRef = useRef(0)
  const [resultScope, setResultScope] = useState(scope.key)
  const [error, setError] = useState(false)
  const shouldResolveInitialVisibility = initialVisibility === 'pending'

  const [galgames, setGalgames] = useState<GalgameCard[]>(initialGalgames)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)
  const hasResolvedInitialVisibilityRef = useRef(false)
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('resource_update_time')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedYears, setSelectedYears] = useState<string[]>(['all'])
  const [selectedMonths, setSelectedMonths] = useState<string[]>(['all'])
  const [page, setPage] = useState(1)
  const [minRatingCount, setMinRatingCount] = useState(
    DEFAULT_GALGAME_MIN_RATING_COUNT
  )

  const fetchPatches = async () => {
    if (!scope.ready || !scope.key) return
    const requestId = ++requestIdRef.current
    const requestScope = scope.key
    setLoading(true)
    setError(false)
    try {
      const { galgames, total } = await kunFetchGet<{
        galgames: GalgameCard[]
        total: number
      }>('/otomegame', {
        selectedType,
        selectedLanguage,
        selectedPlatform,
        sortField,
        sortOrder,
        page,
        limit: 24,
        yearString: JSON.stringify(selectedYears),
        monthString: JSON.stringify(selectedMonths),
        minRatingCount: sortField === 'rating' ? minRatingCount : 0
      })

      if (
        requestId !== requestIdRef.current ||
        requestScope !== scopeRef.current
      )
        return
      setResultScope(requestScope)
      setGalgames(galgames)
      setTotal(total)
    } catch {
      if (
        requestId === requestIdRef.current &&
        requestScope === scopeRef.current
      )
        setError(true)
    } finally {
      if (
        requestId === requestIdRef.current &&
        requestScope === scopeRef.current
      )
        setLoading(false)
    }
  }

  useEffect(() => {
    if (!isMounted || !scope.ready) {
      return
    }

    if (!hasResolvedInitialVisibilityRef.current) {
      hasResolvedInitialVisibilityRef.current = true

      const defaultFilters =
        page === 1 &&
        selectedType === 'all' &&
        selectedLanguage === 'all' &&
        selectedPlatform === 'all' &&
        sortField === 'resource_update_time' &&
        sortOrder === 'desc' &&
        selectedYears.length === 1 &&
        selectedYears[0] === 'all' &&
        selectedMonths.length === 1 &&
        selectedMonths[0] === 'all'
      if (
        defaultFilters &&
        (shouldResolveInitialVisibility
          ? scope.isPublic
          : resultScope === scope.key)
      ) {
        setResultScope(scope.key)
        setGalgames(initialGalgames)
        setTotal(initialTotal)
        setLoading(false)
        return
      }
    }

    fetchPatches()
  }, [
    isMounted,
    scope.key,
    scope.ready,
    shouldResolveInitialVisibility,
    sortField,
    sortOrder,
    selectedType,
    selectedLanguage,
    selectedPlatform,
    page,
    selectedYears,
    selectedMonths,
    sortField === 'rating' ? minRatingCount : null
  ])

  useEffect(
    () => () => {
      requestIdRef.current += 1
    },
    []
  )
  const waiting = loading || scope.key === null || resultScope !== scope.key

  return (
    <div className="container mx-auto my-4 space-y-6">
      <KunHeader
        name="游戏下载"
        description="这里展示了本站所有的游戏, 您可以点击进入以下载游戏资源"
      />

      <FilterBar
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        sortField={sortField}
        setSortField={setSortField}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={setSelectedLanguage}
        selectedPlatform={selectedPlatform}
        setSelectedPlatform={setSelectedPlatform}
        selectedYears={selectedYears}
        setSelectedYears={setSelectedYears}
        selectedMonths={selectedMonths}
        setSelectedMonths={setSelectedMonths}
        minRatingCount={minRatingCount}
        setMinRatingCount={setMinRatingCount}
      />

      {error ? (
        <div role="alert">
          游戏列表读取失败，请重试。
          <Button
            onPress={() => {
              void fetchPatches()
            }}
            isDisabled={!scope.ready}
          >
            重试
          </Button>
        </div>
      ) : waiting ? (
        <KunLoading hint="正在获取 OtomeGame 中..." className="min-h-64" />
      ) : (
        <div className="grid grid-cols-2 gap-2 mx-auto mb-8 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {galgames.map((pa) => (
            <GalgameCard key={pa.id} patch={pa} />
          ))}
        </div>
      )}

      {!waiting && !error && total > 24 && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(total / 24)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
