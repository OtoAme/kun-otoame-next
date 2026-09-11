'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Inbox,
  RefreshCw,
  Search
} from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Separator } from '~/components/dashboard/ui/separator'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/dashboard/ui/table'

import { cn } from '~/lib/dashboard/utils'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { LEDGER_LIMIT_OPTIONS, useLedger } from '~/hooks/dashboard/useLedger'
import type {
  MoemoepointBalance,
  MoemoepointLedgerEntry,
  MoemoepointLedgerKind
} from '~/types/api/moemoepoint'

import { GrantMoemoepointDialog } from './GrantMoemoepointDialog'

export interface DashboardLedgerProps {
  userId: number
  currentUserId: number
}

const RANGE_TABS: { value: '7d' | '30d' | 'custom'; label: string }[] = [
  { value: '7d', label: '7 天内' },
  { value: '30d', label: '30 天内' },
  { value: 'custom', label: '自定义日期' }
]

const KIND_META: Record<
  MoemoepointLedgerKind,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  opening: { label: '初始余额', variant: 'secondary' },
  earn: { label: '获得', variant: 'default' },
  spend: { label: '消费', variant: 'destructive' },
  reserve: { label: '暂扣', variant: 'secondary' },
  release: { label: '返还', variant: 'secondary' },
  forfeit: { label: '确认扣除', variant: 'destructive' },
  refund: { label: '退款', variant: 'default' },
  reversal: { label: '回退', variant: 'secondary' },
  adjustment: { label: '调整', variant: 'secondary' }
}

const kindMeta = (kind: string) =>
  KIND_META[kind as MoemoepointLedgerKind] ?? {
    label: '其他变动',
    variant: 'outline' as const
  }

const formatDelta = (value: number) => (value > 0 ? `+${value}` : `${value}`)

/**
 * 仅允许站内相对路径（禁止 // 与反斜杠）或 http(s) 绝对链接，其余一律不渲染为链接。
 * 先整体拒绝空白与控制字符：浏览器会静默清洗它们，可能让带换行/空格的输入绕过前缀检查
 */
const isSafeRecordLink = (link: string) => {
  if (
    !link ||
    /\s/.test(link) ||
    [...link].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    }) ||
    link.includes('\\')
  ) {
    return false
  }
  if (link.startsWith('/')) {
    return !link.startsWith('//')
  }
  return /^https?:\/\//i.test(link)
}

const Delta = ({
  value,
  neutral = false
}: {
  value: number
  neutral?: boolean
}) => (
  <span
    className={cn(
      'tabular-nums',
      neutral || value === 0
        ? 'text-muted-foreground'
        : value < 0
          ? 'text-destructive'
          : 'text-primary'
    )}
  >
    {formatDelta(value)}
  </span>
)

const DeltaTriple = ({
  total,
  reserved,
  available
}: {
  total: number
  reserved: number
  available: number
}) => (
  <div className="flex flex-col gap-0.5 whitespace-nowrap text-sm">
    <div>
      总 <Delta value={total} />
    </div>
    <div>
      待结算 <Delta value={reserved} neutral />
    </div>
    <div>
      可用 <Delta value={available} />
    </div>
  </div>
)

const AfterTriple = ({ balance }: { balance: MoemoepointBalance }) => (
  <div className="flex flex-col gap-0.5 whitespace-nowrap text-sm text-muted-foreground">
    <div>
      总{' '}
      <span
        className={cn('tabular-nums', balance.total < 0 && 'text-destructive')}
      >
        {balance.total}
      </span>
    </div>
    <div>
      待结算 <span className="tabular-nums">{balance.reserved}</span>
    </div>
    <div>
      可用{' '}
      <span
        className={cn(
          'tabular-nums',
          balance.available < 0 && 'text-destructive'
        )}
      >
        {balance.available}
      </span>
    </div>
  </div>
)

const RecordReason = ({ entry }: { entry: MoemoepointLedgerEntry }) => {
  const link = entry.link
  const safe = isSafeRecordLink(link)
  const linkClass =
    'inline-flex items-center gap-1 text-sm text-primary hover:underline'
  return (
    <div className="min-w-0 space-y-1">
      <p className="whitespace-pre-wrap break-words text-sm">{entry.reason}</p>
      {safe &&
        (link.startsWith('/') ? (
          <Link href={link} prefetch={false} className={linkClass}>
            查看相关内容
          </Link>
        ) : (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            查看相关内容 <ExternalLink className="size-3.5" />
          </a>
        ))}
    </div>
  )
}

export const DashboardLedger = ({
  userId,
  currentUserId
}: DashboardLedgerProps) => {
  const {
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
  } = useLedger({ userId, currentUserId })

  // 发放成功后按当前已应用查询刷新（含余额），不重置任何筛选
  const handleGranted = useCallback(
    (grantedUserId: number) => {
      if (grantedUserId === userId) {
        retry()
      }
    },
    [userId, retry]
  )

  const headerUser = data?.user ?? null
  const balance = data?.balance ?? null
  const records = data?.records ?? []
  const pagination = data?.pagination ?? null
  const appliedRange = data?.range ?? null
  const paginationDisabled = loading || awaiting

  const renderBalanceCard = (
    title: string,
    value: number | null,
    negativeDestructive: boolean
  ) => (
    <Card key={title}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {value === null ? (
          status === 'error' ? (
            <span className="text-2xl font-bold text-muted-foreground">—</span>
          ) : (
            <Skeleton className="h-8 w-24" />
          )
        ) : (
          <span
            className={cn(
              'text-2xl font-bold tabular-nums',
              negativeDestructive && value < 0 && 'text-destructive'
            )}
          >
            {value}
          </span>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-lg font-semibold">用户萌萌点明细</h2>
          {headerUser ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                href={`/user/${headerUser.id}`}
                prefetch={false}
                className="font-medium hover:underline"
              >
                {headerUser.name}
              </Link>
              <Badge variant="secondary">UID {headerUser.id}</Badge>
            </div>
          ) : status === 'error' ? (
            <p className="text-sm text-muted-foreground">未能加载用户信息</p>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        {headerUser && headerUser.id === userId && (
          <GrantMoemoepointDialog
            user={{ id: headerUser.id, name: headerUser.name }}
            currentUserId={currentUserId}
            onGranted={handleGranted}
          />
        )}
      </header>
      <Separator />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
          <section className="grid gap-3 sm:grid-cols-3">
            {renderBalanceCard('总萌萌点', balance?.total ?? null, true)}
            {renderBalanceCard('可用萌萌点', balance?.available ?? null, true)}
            {renderBalanceCard(
              '待结算萌萌点',
              balance?.reserved ?? null,
              false
            )}
          </section>
          <p className="text-sm text-muted-foreground">
            可用萌萌点 = 总萌萌点 -
            待结算萌萌点；消费和余额门槛以可用萌萌点为准。
          </p>
          {balance && balance.total < 0 && (
            <Card>
              <CardContent className="py-3 text-sm text-destructive">
                当前总萌萌点为负。通常是已经获得的奖励被收回（例如资源被删除或点赞被取消）。
                这笔回退会保留在明细里，之后获得的萌萌点会从当前总额继续累积。
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-4 py-4">
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="日期范围"
              >
                {RANGE_TABS.map((tab) => (
                  <Button
                    key={tab.value}
                    size="sm"
                    variant={query.preset === tab.value ? 'default' : 'outline'}
                    onClick={() => selectPreset(tab.value)}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>

              {query.preset === 'custom' && (
                <div className="space-y-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="space-y-1">
                      <label
                        htmlFor="ledger-start-date"
                        className="text-sm text-muted-foreground"
                      >
                        开始日期
                      </label>
                      <Input
                        id="ledger-start-date"
                        type="date"
                        value={draftStart}
                        max={today}
                        onChange={(event) => setDraftStart(event.target.value)}
                        className="w-full sm:w-44"
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="ledger-end-date"
                        className="text-sm text-muted-foreground"
                      >
                        结束日期
                      </label>
                      <Input
                        id="ledger-end-date"
                        type="date"
                        value={draftEnd}
                        max={today}
                        onChange={(event) => setDraftEnd(event.target.value)}
                        className="w-full sm:w-44"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="h-9 shrink-0"
                      onClick={applyCustom}
                    >
                      <Search className="size-4" />
                      查询
                    </Button>
                  </div>
                  {draftError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {draftError}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      自定义范围最长 90 天，起止日期均包含在内。
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <h2 className="text-base font-semibold leading-none">变动记录</h2>
              {appliedRange && (
                <span className="text-sm text-muted-foreground">
                  当前范围：{appliedRange.start} ~ {appliedRange.end}
                </span>
              )}
            </CardHeader>
            <CardContent className="min-w-0">
              {status === 'awaiting' && (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <CalendarSearch className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    请选择日期并查询
                  </p>
                </div>
              )}

              {status === 'loading' && (
                <div className="space-y-2 py-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              )}

              {status === 'error' && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <AlertTriangle className="size-8 text-destructive" />
                  <p role="alert" className="text-sm text-destructive">
                    {errorMessage}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={retry}
                    disabled={loading}
                  >
                    <RefreshCw className="size-4" />
                    重试
                  </Button>
                </div>
              )}

              {status === 'ready' && records.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Inbox className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    当前时间范围内暂无萌萌点变动记录
                  </p>
                </div>
              )}

              {status === 'ready' && records.length > 0 && (
                <>
                  <div className="hidden md:block">
                    <Table className="min-w-[720px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">
                            时间
                          </TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>变动（总 / 待结算 / 可用）</TableHead>
                          <TableHead>变动后（总 / 待结算 / 可用）</TableHead>
                          <TableHead>原因</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((entry) => {
                          const meta = kindMeta(entry.kind)
                          return (
                            <TableRow key={entry.id}>
                              <TableCell className="whitespace-nowrap text-sm">
                                {formatChinaDateTime(entry.created)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={meta.variant}>
                                  {meta.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <DeltaTriple
                                  total={entry.balanceDelta}
                                  reserved={entry.reservedDelta}
                                  available={entry.availableDelta}
                                />
                              </TableCell>
                              <TableCell>
                                <AfterTriple balance={entry.balanceAfter} />
                              </TableCell>
                              <TableCell className="min-w-[200px]">
                                <RecordReason entry={entry} />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {records.map((entry) => {
                      const meta = kindMeta(entry.kind)
                      return (
                        <div
                          key={entry.id}
                          className="space-y-3 rounded-lg border p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {formatChinaDateTime(entry.created)}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                变动（总 / 待结算 / 可用）
                              </p>
                              <DeltaTriple
                                total={entry.balanceDelta}
                                reserved={entry.reservedDelta}
                                available={entry.availableDelta}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                变动后（总 / 待结算 / 可用）
                              </p>
                              <AfterTriple balance={entry.balanceAfter} />
                            </div>
                          </div>
                          <RecordReason entry={entry} />
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </CardContent>

            {pagination && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
                <span className="text-sm text-muted-foreground">
                  共 {pagination.total} 条记录 · 第 {pagination.page} /{' '}
                  {Math.max(pagination.totalPages, 1)} 页
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    每页条数
                  </span>
                  <Select
                    value={String(query.limit)}
                    onValueChange={(value) => changeLimit(Number(value))}
                    disabled={paginationDisabled}
                  >
                    <SelectTrigger className="h-8 w-24" aria-label="每页条数">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEDGER_LIMIT_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option}
                        </SelectItem>
                      ))}
                      {!LEDGER_LIMIT_OPTIONS.includes(query.limit) && (
                        <SelectItem value={String(query.limit)}>
                          {query.limit}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={paginationDisabled || pagination.page <= 1}
                    onClick={() => goToPage(pagination.page - 1)}
                  >
                    <ChevronLeft className="size-4" />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      paginationDisabled ||
                      pagination.page >= pagination.totalPages
                    }
                    onClick={() => goToPage(pagination.page + 1)}
                  >
                    下一页
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
