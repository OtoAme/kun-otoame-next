'use client'

import {
  Chip,
  Input,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow
} from '@heroui/react'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RenderCell } from './RenderCell'
import { kunFetchGet } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { useMounted } from '~/hooks/useMounted'
import { useDebounce } from 'use-debounce'
import { KunPagination } from '~/components/kun/Pagination'
import type { AdminGalgame } from '~/types/api/admin'

const columns = [
  { name: '封面', uid: 'banner' },
  { name: '标题', uid: 'name' },
  { name: '用户', uid: 'user' },
  { name: '时间', uid: 'created' }
]

interface Props {
  initialGalgames: AdminGalgame[]
  initialTotal: number
}

export const Galgame = ({ initialGalgames, initialTotal }: Props) => {
  const [galgames, setGalgames] = useState<AdminGalgame[]>(initialGalgames)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(30)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery] = useDebounce(searchQuery, 500)
  const isMounted = useMounted()

  const [loading, setLoading] = useState(false)
  const fetchData = async () => {
    setLoading(true)

    const { galgames, total } = await kunFetchGet<{
      galgames: AdminGalgame[]
      total: number
    }>('/admin/otomegame', {
      page,
      limit,
      search: debouncedQuery
    })

    setLoading(false)
    setGalgames(galgames)
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">游戏管理</h1>
        <Chip color="primary" variant="flat">
          正在开发中...
        </Chip>
      </div>

      <Input
        fullWidth
        isClearable
        placeholder="输入游戏名搜索游戏"
        startContent={<Search className="text-default-300" size={20} />}
        value={searchQuery}
        onValueChange={handleSearch}
      />

      {loading ? (
        <KunLoading hint="正在获取 OtomeGame 数据..." />
      ) : (
        <Table
          aria-label="游戏管理"
          bottomContent={
            <div className="flex flex-col items-center justify-center w-full gap-4 sm:flex-row">
              <Select
                className="w-32"
                label="每页显示"
                selectedKeys={[String(limit)]}
                size="sm"
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
                page={page}
                total={Math.ceil(total / limit)}
                onPageChange={setPage}
                isLoading={loading}
              />
            </div>
          }
        >
          <TableHeader columns={columns}>
            {(column) => (
              <TableColumn key={column.uid}>{column.name}</TableColumn>
            )}
          </TableHeader>
          <TableBody items={galgames}>
            {(item) => (
              <TableRow key={item.id}>
                {(columnKey) => (
                  <TableCell>
                    {RenderCell(item, columnKey.toString())}
                  </TableCell>
                )}
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
