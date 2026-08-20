'use client'

import { useEffect, useRef, useState, type Key } from 'react'
import NextLink from 'next/link'
import { parseDate, today, type CalendarDate } from '@internationalized/date'
import {
  Button,
  Card,
  CardBody,
  Chip,
  DateRangePicker,
  Link,
  Spinner,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tabs
} from '@heroui/react'
import { CircleDollarSign, Clock3, WalletCards } from 'lucide-react'
import { KunHeader } from '~/components/kun/Header'
import { KunPagination } from '~/components/kun/Pagination'
import { kunFetchGet } from '~/utils/kunFetch'
import {
  getMoemoepointRangeDays,
  MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS,
  type MoemoepointRangePreset
} from '~/utils/moemoepointDateRange'
import type {
  MoemoepointBalance,
  MoemoepointLedgerEntry,
  MoemoepointLedgerKind,
  MoemoepointLedgerResponse
} from '~/types/api/moemoepoint'
import { useUserStore } from '~/store/userStore'

type KindView = {
  label: string
  color: 'default' | 'success' | 'danger' | 'warning' | 'primary'
}

const KIND_VIEW: Record<MoemoepointLedgerKind, KindView> = {
  opening: { label: '初始余额', color: 'default' },
  earn: { label: '获得', color: 'success' },
  spend: { label: '消费', color: 'danger' },
  reserve: { label: '暂扣', color: 'warning' },
  release: { label: '返还', color: 'primary' },
  forfeit: { label: '确认扣除', color: 'danger' },
  refund: { label: '退款', color: 'success' },
  reversal: { label: '回退', color: 'danger' },
  adjustment: { label: '调整', color: 'default' }
}

// kind 来自数据库的 String 列。生产有 CHECK 约束, 但开发库走 prisma db push
// 没有约束; 一个意外值会让 view.label 读到 undefined 而整页白屏。
const resolveKindView = (kind: MoemoepointLedgerKind): KindView =>
  KIND_VIEW[kind] ?? { label: kind, color: 'default' }

const formatDelta = (value: number) => (value > 0 ? `+${value}` : String(value))

const deltaClassName = (value: number) =>
  value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-default-500'

const balanceValueClassName = (value: number) =>
  value < 0 ? 'text-danger' : undefined

const formatCreated = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))

const BalanceCard = ({
  label,
  value,
  description,
  icon: Icon,
  color
}: {
  label: string
  value: number
  description: string
  icon: typeof WalletCards
  color: string
}) => (
  <Card>
    <CardBody className="flex flex-row items-center gap-4 p-5">
      <div className={`rounded-full bg-default-100 p-3 ${color}`}>
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm text-default-500">{label}</p>
        <p
          className={`text-2xl font-semibold tabular-nums ${
            balanceValueClassName(value) ?? ''
          }`}
        >
          {value}
        </p>
        <p className="text-xs text-default-400">{description}</p>
      </div>
    </CardBody>
  </Card>
)

const DeltaGroup = ({ record }: { record: MoemoepointLedgerEntry }) => (
  <div className="space-y-1 text-xs tabular-nums">
    <p className={deltaClassName(record.balanceDelta)}>
      总额 {formatDelta(record.balanceDelta)}
    </p>
    <p className={deltaClassName(record.reservedDelta)}>
      待结算 {formatDelta(record.reservedDelta)}
    </p>
    <p className={deltaClassName(record.availableDelta)}>
      可用 {formatDelta(record.availableDelta)}
    </p>
  </div>
)

const BalanceSnapshot = ({ balance }: { balance: MoemoepointBalance }) => (
  <div className="space-y-1 text-xs tabular-nums text-default-500">
    <p>总额 {balance.total}</p>
    <p>待结算 {balance.reserved}</p>
    <p>可用 {balance.available}</p>
  </div>
)

const RecordReason = ({ record }: { record: MoemoepointLedgerEntry }) => {
  const view = resolveKindView(record.kind)
  return (
    <div className="space-y-2">
      <Chip color={view.color} variant="flat" size="sm">
        {view.label}
      </Chip>
      {record.link ? (
        <Link as={NextLink} href={record.link} size="sm" color="foreground">
          {record.reason}
        </Link>
      ) : (
        <p className="text-sm">{record.reason}</p>
      )}
    </div>
  )
}

// 移动端用卡片, 4 列表格在窄屏会横向溢出 (变动和余额各占 3 行)。
const RecordCard = ({ record }: { record: MoemoepointLedgerEntry }) => (
  <Card shadow="sm">
    <CardBody className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <RecordReason record={record} />
        <span className="whitespace-nowrap text-xs text-default-500">
          {formatCreated(record.created)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <DeltaGroup record={record} />
        <BalanceSnapshot balance={record.balanceAfter} />
      </div>
    </CardBody>
  </Card>
)

export const MoemoepointLedgerContainer = ({
  userId,
  initialData,
  title = '我的萌萌点',
  showRulesLink = true
}: {
  userId: number
  initialData: MoemoepointLedgerResponse
  title?: string
  showRulesLink?: boolean
}) => {
  const [data, setData] = useState(initialData)
  const [range, setRange] = useState<MoemoepointRangePreset>('30d')
  const [customRange, setCustomRange] = useState<{
    start: CalendarDate
    end: CalendarDate
  }>({
    start: parseDate(initialData.range.start),
    end: parseDate(initialData.range.end)
  })
  // 自定义日期需要显式点「查询」。在点之前不要展示上一个范围的数据,
  // 否则 tab 写着「自定义日期」而表格是 30 天的内容。
  const [awaitingCustomQuery, setAwaitingCustomQuery] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const currentUserId = useUserStore((state) => state.user.uid)
  const setMoemoepointBalance = useUserStore(
    (state) => state.setMoemoepointBalance
  )

  useEffect(() => {
    // 管理员查看他人流水时不能覆盖自己顶栏的余额。
    if (currentUserId === userId) {
      setMoemoepointBalance(data.balance)
    }
  }, [currentUserId, data.balance, setMoemoepointBalance, userId])

  const fetchLedger = async (
    nextRange: MoemoepointRangePreset,
    nextPage: number,
    dates = customRange
  ) => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const response = await kunFetchGet<MoemoepointLedgerResponse | string>(
        `/user/${userId}/moemoepoint/ledger`,
        {
          range: nextRange,
          page: nextPage,
          limit: 30,
          ...(nextRange === 'custom'
            ? { start: dates.start.toString(), end: dates.end.toString() }
            : {})
        }
      )
      if (currentRequest !== requestId.current) {
        return
      }
      if (typeof response === 'string') {
        setError(response)
        return
      }
      setData(response)
      setPage(nextPage)
      setAwaitingCustomQuery(false)
    } catch {
      if (currentRequest === requestId.current) {
        setError('萌萌点流水加载失败，请稍后重试')
      }
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
      }
    }
  }

  const selectRange = (key: Key) => {
    const nextRange = key as MoemoepointRangePreset
    setRange(nextRange)
    if (nextRange === 'custom') {
      requestId.current += 1
      setLoading(false)
      setError('')
      setAwaitingCustomQuery(true)
      return
    }
    setAwaitingCustomQuery(false)
    void fetchLedger(nextRange, 1)
  }

  const applyCustomRange = () => {
    const days = getMoemoepointRangeDays(
      customRange.start.toString(),
      customRange.end.toString()
    )
    if (days === null || days < 1) {
      setError('结束日期不能早于开始日期')
      return
    }
    if (days > MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS) {
      setError(`自定义日期范围最多为 ${MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS} 天`)
      return
    }
    void fetchLedger('custom', 1, customRange)
  }

  const records: MoemoepointLedgerEntry[] = awaitingCustomQuery
    ? []
    : data.records
  const emptyContent = awaitingCustomQuery
    ? '请选择日期范围后点击查询'
    : '所选日期内暂无萌萌点流水'
  const showPagination = !awaitingCustomQuery && data.pagination.totalPages > 1

  const changePage = (nextPage: number) => {
    void fetchLedger(data.range.preset, nextPage, {
      start: parseDate(data.range.start),
      end: parseDate(data.range.end)
    })
  }

  return (
    <div className="container mx-auto my-4 space-y-6">
      <KunHeader
        name={title}
        description="查看每一笔萌萌点获得、消费、暂扣、返还和确认扣除记录"
        headerEndContent={
          showRulesLink ? (
            <Link as={NextLink} href="/moemoepoint/rules" size="sm">
              萌萌点规则
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <BalanceCard
          label="总萌萌点"
          value={data.balance.total}
          description="包含被暂扣的部分"
          icon={CircleDollarSign}
          color="text-primary"
        />
        <BalanceCard
          label="可用萌萌点"
          value={data.balance.available}
          description="当前可以消费或暂扣"
          icon={WalletCards}
          color="text-success"
        />
        <BalanceCard
          label="待结算萌萌点"
          value={data.balance.reserved}
          description="等待返还或确认扣除"
          icon={Clock3}
          color="text-warning"
        />
      </div>

      {data.balance.total < 0 && (
        <Card>
          <CardBody className="text-sm text-danger">
            当前余额为负, 通常是发布奖励被收回导致的（例如资源被删除或点赞被取消）。
            可以通过每日签到重新累积。
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-4">
          <Tabs
            aria-label="萌萌点流水日期范围"
            selectedKey={range}
            onSelectionChange={selectRange}
            color="primary"
            variant="underlined"
          >
            <Tab key="7d" title="7 天内" />
            <Tab key="30d" title="30 天内" />
            <Tab key="custom" title="自定义日期" />
          </Tabs>

          {range === 'custom' && (
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
              <DateRangePicker
                className="max-w-xl"
                label="日期范围"
                value={customRange}
                onChange={(value) => {
                  if (value) {
                    setCustomRange({
                      start: value.start as CalendarDate,
                      end: value.end as CalendarDate
                    })
                    setError('')
                  }
                }}
                firstDayOfWeek="mon"
                maxValue={today('Asia/Shanghai')}
                showMonthAndYearPickers
                description={`单次最多查询 ${MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS} 天`}
              />
              <Button
                color="primary"
                onPress={applyCustomRange}
                isLoading={loading}
              >
                查询
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3 sm:hidden">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner label="正在加载萌萌点流水" />
          </div>
        ) : records.length ? (
          records.map((record) => (
            <RecordCard key={record.id} record={record} />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-default-500">
            {emptyContent}
          </p>
        )}
      </div>

      <div className="hidden sm:block">
        <Table aria-label="萌萌点变动明细" isHeaderSticky>
          <TableHeader>
            <TableColumn>时间</TableColumn>
            <TableColumn>类型与原因</TableColumn>
            <TableColumn>变动</TableColumn>
            <TableColumn>变更后余额</TableColumn>
          </TableHeader>
          <TableBody
            items={records}
            emptyContent={emptyContent}
            isLoading={loading}
            loadingContent={<Spinner label="正在加载萌萌点流水" />}
          >
            {(record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <span className="whitespace-nowrap text-sm text-default-500">
                    {formatCreated(record.created)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="min-w-44">
                    <RecordReason record={record} />
                  </div>
                </TableCell>
                <TableCell>
                  <DeltaGroup record={record} />
                </TableCell>
                <TableCell>
                  <BalanceSnapshot balance={record.balanceAfter} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && (
        <div className="flex justify-center">
          <KunPagination
            page={page}
            total={data.pagination.totalPages}
            onPageChange={changePage}
            isLoading={loading}
          />
        </div>
      )}
    </div>
  )
}
