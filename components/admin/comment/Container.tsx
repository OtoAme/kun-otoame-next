'use client'

import { Input, Select, SelectItem } from '@heroui/react'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { useMounted } from '~/hooks/useMounted'
import { CommentCard } from './Card'
import { useDebounce } from 'use-debounce'
import { KunPagination } from '~/components/kun/Pagination'
import type { AdminComment } from '~/types/api/admin'

interface Props {
  initialComments: AdminComment[]
  initialTotal: number
}

export const Comment = ({ initialComments, initialTotal }: Props) => {
  const [comments, setComments] = useState<AdminComment[]>(initialComments)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery] = useDebounce(searchQuery, 500)
  const isMounted = useMounted()

  const [loading, setLoading] = useState(false)
  const fetchData = async () => {
    setLoading(true)

    const { comments, total } = await kunFetchGet<{
      comments: AdminComment[]
      total: number
    }>('/admin/comment', {
      page,
      limit,
      search: debouncedQuery
    })

    setLoading(false)
    setComments(comments)
    setTotal(total)
  }

  useEffect(() => {
    if (!isMounted) {
      return
    }
    fetchData()
  }, [page, limit, debouncedQuery])

  const handleSearch = (value: string) => {
    setSearchQuery(value)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">评论管理</h1>

      <Input
        fullWidth
        isClearable
        placeholder="输入评论内容搜索评论"
        startContent={<Search className="text-default-300" size={20} />}
        value={searchQuery}
        onValueChange={handleSearch}
      />

      <div className="space-y-4">
        {loading ? (
          <KunLoading hint="正在获取评论数据..." />
        ) : (
          <>
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </>
        )}
      </div>

      <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Select
          aria-label="每页显示数量"
          size="sm"
          className="w-20"
          selectedKeys={new Set([String(limit)])}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0]
            if (!selected) {
              return
            }
            setLimit(Number(selected))
            setPage(1)
          }}
        >
          <SelectItem key="30">30</SelectItem>
          <SelectItem key="50">50</SelectItem>
          <SelectItem key="100">100</SelectItem>
          <SelectItem key="500">500</SelectItem>
        </Select>
        <KunPagination
          total={Math.ceil(total / limit)}
          page={page}
          onPageChange={setPage}
          isLoading={loading}
        />
      </div>
    </div>
  )
}
