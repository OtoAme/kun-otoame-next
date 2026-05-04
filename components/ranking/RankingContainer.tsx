'use client'

import { useEffect, useState } from 'react'
import { Select, SelectItem } from '@heroui/select'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunHeader } from '~/components/kun/Header'
import { KunLoading } from '~/components/kun/Loading'
import { KunPagination } from '~/components/kun/Pagination'
import { useMounted } from '~/hooks/useMounted'
import { RankingList } from './RankingList'
import type { RankingCard, RankingSortField } from '~/types/api/ranking'

interface Props {
  initialGalgames: RankingCard[]
  initialTotal: number
  initialSortField: RankingSortField
  initialSortOrder: 'asc' | 'desc'
  initialMinRatingCount: number
  pageSize: number
}

const sortOptions: { key: RankingSortField; label: string }[] = [
  { key: 'rating', label: '评分' },
  { key: 'rating_count', label: '评分人数' },
  { key: 'like', label: '推荐数' },
  { key: 'favorite', label: '收藏数' },
  { key: 'resource', label: '资源数' },
  { key: 'comment', label: '评论数' },
  { key: 'download', label: '下载数' },
  { key: 'view', label: '浏览数' }
]

export const RankingContainer = ({
  initialGalgames,
  initialTotal,
  initialSortField,
  initialSortOrder,
  initialMinRatingCount,
  pageSize
}: Props) => {
  const [galgames, setGalgames] = useState(initialGalgames)
  const [total, setTotal] = useState(initialTotal)
  const [sortField, setSortField] = useState(initialSortField)
  const [sortOrder, setSortOrder] = useState(initialSortOrder)
  const [minRatingCount, setMinRatingCount] = useState(initialMinRatingCount)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const isMounted = useMounted()

  const fetchRanking = async () => {
    setLoading(true)
    const response = await kunFetchGet<{
      galgames: RankingCard[]
      total: number
    }>('/ranking', {
      sortField,
      sortOrder,
      minRatingCount,
      page,
      limit: pageSize
    })

    setGalgames(response.galgames)
    setTotal(response.total)
    setLoading(false)
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }
    fetchRanking()
  }, [sortField, sortOrder, minRatingCount, page])

  return (
    <div className="container mx-auto my-4 space-y-6">
      <KunHeader name="OtomeGame 排行榜" description="按评分、收藏、资源等维度浏览 OtomeGame" />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select
          className="w-full sm:max-w-48"
          label="排序字段"
          selectedKeys={[sortField]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as RankingSortField | undefined
            if (value) {
              setSortField(value)
              setPage(1)
            }
          }}
        >
          {sortOptions.map((option) => (
            <SelectItem key={option.key}>{option.label}</SelectItem>
          ))}
        </Select>

        <Select
          className="w-full sm:max-w-40"
          label="排序方向"
          selectedKeys={[sortOrder]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as 'asc' | 'desc' | undefined
            if (value) {
              setSortOrder(value)
              setPage(1)
            }
          }}
        >
          <SelectItem key="desc">降序</SelectItem>
          <SelectItem key="asc">升序</SelectItem>
        </Select>

        <Select
          className="w-full sm:max-w-40"
          label="最低评分数"
          selectedKeys={[String(minRatingCount)]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0]
            if (value) {
              setMinRatingCount(Number(value))
              setPage(1)
            }
          }}
        >
          <SelectItem key="0">不限</SelectItem>
          <SelectItem key="5">5</SelectItem>
          <SelectItem key="10">10</SelectItem>
          <SelectItem key="30">30</SelectItem>
          <SelectItem key="50">50</SelectItem>
        </Select>
      </div>

      {loading ? (
        <KunLoading hint="正在获取排行榜数据..." />
      ) : (
        <RankingList galgames={galgames} page={page} pageSize={pageSize} />
      )}

      {total > pageSize && (
        <div className="flex justify-center">
          <KunPagination
            total={Math.ceil(total / pageSize)}
            page={page}
            onPageChange={setPage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
