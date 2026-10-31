'use client'

import Link from 'next/link'
import { RefreshCw, Search } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent, CardHeader } from '~/components/dashboard/ui/card'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/dashboard/ui/table'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { LinkHealthListRow } from '~/types/api/linkHealth'
import type { UseAdminLinkHealthReturn } from './useAdminLinkHealth'

const brokenDaysText = (seconds: number | null): string => {
  if (seconds === null) return '未知'
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `${days} 天`
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) return `${hours} 小时`
  return '不足 1 小时'
}

const FiltersBar = ({ view }: { view: UseAdminLinkHealthReturn }) => {
  const { filters, setFilters, applyFilters, loading } = view
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">归属方</span>
        <Select
          value={filters.ownerType || 'all'}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              ownerType: value === 'all' ? '' : (value as 'publisher' | 'staff')
            })
          }
        >
          <SelectTrigger aria-label="归属方" className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="publisher">发布者</SelectItem>
            <SelectItem value="staff">站方</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">资源盘链接</span>
        <Select
          value={filters.hasTouchgalLink || 'all'}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              hasTouchgalLink:
                value === 'all' ? '' : (value as 'true' | 'false')
            })
          }
        >
          <SelectTrigger aria-label="资源盘链接" className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="true">已有资源盘链接</SelectItem>
            <SelectItem value="false">没有资源盘链接</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">网盘主机</span>
        <Input
          aria-label="网盘主机"
          className="h-8 w-44"
          placeholder="如 pan.example.com"
          value={filters.hostname}
          disabled={filters.otherHost}
          onChange={(event) =>
            setFilters({ ...filters, hostname: event.target.value })
          }
        />
      </div>

      <label className="flex select-none items-center gap-1.5 pb-1.5 text-sm">
        <Checkbox
          checked={filters.otherHost}
          onCheckedChange={(value) =>
            setFilters({ ...filters, otherHost: value === true })
          }
          aria-label="只看无法解析主机"
        />
        只看无法解析主机
      </label>

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">最短失效天数</span>
        <Input
          aria-label="最短失效天数"
          className="h-8 w-28"
          inputMode="numeric"
          placeholder="0"
          value={filters.minBrokenDays}
          onChange={(event) =>
            setFilters({
              ...filters,
              minBrokenDays: event.target.value.replace(/[^0-9]/g, '')
            })
          }
        />
      </div>

      <Button type="button" size="sm" disabled={loading} onClick={applyFilters}>
        <Search className="size-4" aria-hidden />
        应用筛选
      </Button>
    </div>
  )
}

const Row = ({ row }: { row: LinkHealthListRow }) => (
  <TableRow>
    <TableCell className="max-w-40 truncate">
      {row.patch.name || row.patch.uniqueId}
    </TableCell>
    <TableCell className="max-w-40 truncate">
      {row.resource.name || '资源备注'}
    </TableCell>
    <TableCell>
      <Badge variant={row.ownerType === 'staff' ? 'default' : 'secondary'}>
        {row.ownerType === 'staff' ? '站方' : '发布者'}
      </Badge>
    </TableCell>
    <TableCell>{row.hostname ?? '无法解析'}</TableCell>
    <TableCell>{brokenDaysText(row.brokenForSeconds)}</TableCell>
    <TableCell>
      {row.healthChangedAt ? formatChinaDateTime(row.healthChangedAt) : '未知'}
    </TableCell>
    <TableCell>
      {row.caseId === null ? (
        <span className="text-muted-foreground">无</span>
      ) : (
        <Link
          href={`/dashboard/case/${row.caseId}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          事项 #{row.caseId}
        </Link>
      )}
    </TableCell>
  </TableRow>
)

/**
 * 站方只读「已失效链接」视图（模块 04，M04-5）：按归属方、资源盘链接、
 * 网盘主机与失效时长筛选；主机失效比例是当前在库链接的健康快照，随批次
 * 上线起算。只看不 做——补链与移除在 broken-link 待办或资源编辑里进行。
 */
export function LinkHealthAdminView({
  view
}: {
  view: UseAdminLinkHealthReturn
}) {
  const { list, loading, error, page, setPage, refresh } = view
  const rows = list?.items ?? []
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      <h2 className="text-lg font-semibold md:text-xl">已失效链接</h2>

      <FiltersBar view={view} />

      {list && list.hosts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-sm font-medium">各网盘当前失效比例</h2>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div className="flex flex-wrap gap-2">
              {list.hosts.map((host) => (
                <Badge
                  key={host.hostname ?? '__other__'}
                  variant="outline"
                  className="gap-1"
                >
                  {host.hostname ?? '其他'}
                  <span className="tabular-nums">
                    {host.brokenLinks}/{host.totalLinks}
                  </span>
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {list.trackingStartedAt
                ? `统计自 ${formatChinaDateTime(list.trackingStartedAt)} 起`
                : '统计自失效检测上线起'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {list ? `共 ${list.total} 条` : '加载中'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw
                className={loading ? 'size-4 animate-spin' : 'size-4'}
                aria-hidden
              />
              刷新
            </Button>
          </div>

          {loading && rows.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refresh}
              >
                重试
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              当前筛选下没有已失效链接。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>所属条目</TableHead>
                  <TableHead>所属资源</TableHead>
                  <TableHead>归属方</TableHead>
                  <TableHead>网盘主机</TableHead>
                  <TableHead>失效时长</TableHead>
                  <TableHead>进入失效</TableHead>
                  <TableHead>关联事项</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Row key={row.linkId} row={row} />
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-muted-foreground tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
