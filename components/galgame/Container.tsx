'use client'

import { useEffect, useRef, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import { GalgameCard } from './Card'
import { FilterBar } from './FilterBar'
import { useMounted } from '~/hooks/useMounted'
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

const getClientNsfwPreference = () => {
  if (typeof document === 'undefined') {
    return 'sfw'
  }

  const cookie = document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) =>
      value.startsWith('kun-patch-setting-store|state|data|kunNsfwEnable=')
    )

  return decodeURIComponent(cookie?.split('=').slice(1).join('=') || 'sfw')
}

export const CardContainer = ({
  initialGalgames,
  initialTotal,
  initialVisibility = 'show'
}: Props) => {
  const isMounted = useMounted()
  const shouldResolveInitialVisibility = initialVisibility === 'pending'

  const [galgames, setGalgames] = useState<GalgameCard[]>(
    shouldResolveInitialVisibility ? [] : initialGalgames
  )
  const [total, setTotal] = useState(
    shouldResolveInitialVisibility ? 0 : initialTotal
  )
  const [loading, setLoading] = useState(shouldResolveInitialVisibility)
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
    setLoading(true)

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

    setGalgames(galgames)
    setTotal(total)
    setLoading(false)
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }

    if (!hasResolvedInitialVisibilityRef.current) {
      hasResolvedInitialVisibilityRef.current = true

      if (shouldResolveInitialVisibility) {
        const nsfwPreference = getClientNsfwPreference()

        if (nsfwPreference === 'sfw') {
          setGalgames(initialGalgames)
          setTotal(initialTotal)
          setLoading(false)
          return
        }

        fetchPatches()
        return
      }

      return
    }

    fetchPatches()
  }, [
    isMounted,
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

      {loading ? (
        <KunLoading hint="正在获取 OtomeGame 中..." className="min-h-64" />
      ) : (
        <div className="grid grid-cols-2 gap-2 mx-auto mb-8 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {galgames.map((pa) => (
            <GalgameCard key={pa.id} patch={pa} />
          ))}
        </div>
      )}

      {!loading && total > 24 && (
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
