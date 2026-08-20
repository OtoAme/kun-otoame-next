'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  Avatar,
  Chip,
  Link as HeroLink,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow
} from '@heroui/react'
import { KunHeader } from '~/components/kun/Header'
import { KunPagination } from '~/components/kun/Pagination'
import { RankingNavigation } from './RankingNavigation'
import { USER_ROLE_MAP } from '~/constants/user'
import { formatNumber } from '~/utils/formatNumber'
import { kunFetchGet } from '~/utils/kunFetch'
import type {
  MoemoepointRankingResponse,
  MoemoepointRankingUser
} from '~/types/api/moemoepoint'

const rankColor = (rank: number) => {
  if (rank === 1) return 'warning' as const
  if (rank === 2) return 'default' as const
  if (rank === 3) return 'secondary' as const
  return 'primary' as const
}

export const MoemoepointRankingContainer = ({
  initialData,
  pageSize
}: {
  initialData: MoemoepointRankingResponse
  pageSize: number
}) => {
  const [users, setUsers] = useState<MoemoepointRankingUser[]>(
    initialData.users
  )
  const [total, setTotal] = useState(initialData.total)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const changePage = async (nextPage: number) => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const response = await kunFetchGet<MoemoepointRankingResponse | string>(
        '/ranking/moemoepoint',
        { page: nextPage, limit: pageSize }
      )
      if (currentRequest !== requestId.current) {
        return
      }
      if (typeof response === 'string') {
        setError(response)
        return
      }
      setUsers(response.users)
      setTotal(response.total)
      setPage(nextPage)
    } catch {
      if (currentRequest === requestId.current) {
        setError('萌萌点排行榜加载失败，请稍后重试')
      }
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="container mx-auto my-4 space-y-6">
      <KunHeader
        name="萌萌点排行榜"
        description="按照萌萌点总额从高到低查看社区排行，待结算萌萌点仍计入总额"
      />
      <RankingNavigation />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Table
        aria-label="萌萌点排行榜"
        isHeaderSticky
        bottomContent={
          totalPages > 1 ? (
            <div className="flex justify-center">
              <KunPagination
                page={page}
                total={totalPages}
                onPageChange={(nextPage) => void changePage(nextPage)}
                isLoading={loading}
              />
            </div>
          ) : null
        }
      >
        <TableHeader>
          <TableColumn>名次</TableColumn>
          <TableColumn>用户</TableColumn>
          <TableColumn>角色</TableColumn>
          <TableColumn align="end">萌萌点总额</TableColumn>
        </TableHeader>
        <TableBody
          items={users}
          emptyContent="暂无可参与排行的用户"
          isLoading={loading}
          loadingContent={<Spinner label="正在加载萌萌点排行榜" />}
        >
          {(user) => (
            <TableRow key={user.id}>
              <TableCell>
                <Chip color={rankColor(user.rank)} variant="flat">
                  {user.rank}
                </Chip>
              </TableCell>
              <TableCell>
                <HeroLink
                  as={Link}
                  href={`/user/${user.id}/comment`}
                  color="foreground"
                  className="inline-flex items-center gap-3"
                >
                  <Avatar
                    src={user.avatar}
                    name={user.name.charAt(0).toUpperCase()}
                    showFallback
                    size="sm"
                  />
                  <span className="font-medium">{user.name}</span>
                </HeroLink>
              </TableCell>
              <TableCell>
                <Chip color="primary" variant="flat" size="sm">
                  {USER_ROLE_MAP[user.role] ?? '用户'}
                </Chip>
              </TableCell>
              <TableCell>
                <p className="text-right text-lg font-semibold tabular-nums text-primary">
                  {formatNumber(user.moemoepoint)}
                </p>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
