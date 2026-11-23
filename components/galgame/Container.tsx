'use client'

import { GalgameCard } from './Card'
import { FilterBar } from './FilterBar'
import { useGalgameList } from '~/hooks/useGalgameList'
import { useGalgameFilters } from '~/hooks/useGalgameFilters'
import type { SessionRenderState } from '~/types/api/session'
import { Button } from '@heroui/button'
import { KunHeader } from '../kun/Header'
import { KunPagination } from '../kun/Pagination'
import {
  DEFAULT_GALGAME_MIN_RATING_COUNT,
  getGalgameListQuery,
  type TagCompanyGalgameFilterState
} from '~/utils/galgameFilter'
import { KunLoading } from '../kun/Loading'

interface Props {
  initialGalgames: GalgameCard[]
  initialTotal: number
  initialScope?: SessionRenderState | null
  initialFilters?: TagCompanyGalgameFilterState
}

export const CardContainer = ({
  initialGalgames,
  initialTotal,
  initialScope = null,
  initialFilters
}: Props) => {
  const { filters, setPage, filterProps } = useGalgameFilters(
    initialFilters,
    DEFAULT_GALGAME_MIN_RATING_COUNT
  )
  const {
    galgames,
    total,
    loading: waiting,
    error,
    ready,
    retry
  } = useGalgameList(
    '/otomegame',
    getGalgameListQuery(filters),
    { galgames: initialGalgames, total: initialTotal },
    initialScope
  )

  return (
    <div className="container mx-auto my-4 space-y-6">
      <KunHeader
        name="游戏下载"
        description="这里展示了本站所有的游戏, 您可以点击进入以下载游戏资源"
      />

      <FilterBar {...filterProps} />

      {error ? (
        <div role="alert">
          游戏列表读取失败，请重试。
          <Button
            onPress={() => {
              retry()
            }}
            isDisabled={!ready}
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
            page={filters.page}
            onPageChange={setPage}
            isLoading={waiting}
          />
        </div>
      )}
    </div>
  )
}
