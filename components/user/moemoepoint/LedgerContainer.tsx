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

const KIND_VIEW: Record<
  MoemoepointLedgerKind,
  {
    label: string
    color: 'default' | 'success' | 'danger' | 'warning' | 'primary'
  }
> = {
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

const formatDelta = (value: number) => (value > 0 ? `+${value}` : String(value))

const deltaClassName = (value: number) =>
  value > 0
    ? 'text-success-600'
    : value < 0
      ? 'text-danger-600'
      : 'text-default-500'

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
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
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

export const MoemoepointLedgerContainer = ({
  userId,
  initialData
}: {
  userId: number
  initialData: MoemoepointLedgerResponse
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
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const currentUserId = useUserStore((state) => state.user.uid)
  const setMoemoepointBalance = useUserStore(
    (state) => state.setMoemoepointBalance
  )

  useEffect(() => {
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
      return
    }
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

  return (
    <section className="space-y-6" aria-labelledby="moemoepoint-ledger-title">
      <div>
        <h2 id="moemoepoint-ledger-title" className="text-2xl font-semibold">
          萌萌点流水
        </h2>
        <p className="mt-1 text-sm text-default-500">
          查看每一笔萌萌点获得、消费、暂扣、返还和确认扣除记录。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <BalanceCard
          label="总萌萌点"
          value={data.balance.total}
          description="排行榜使用此数值"
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

      <Table
        aria-label="萌萌点变动明细"
        isHeaderSticky
        bottomContent={
          data.pagination.totalPages > 1 ? (
            <div className="flex justify-center">
              <KunPagination
                page={page}
                total={data.pagination.totalPages}
                onPageChange={(nextPage) => {
                  void fetchLedger(data.range.preset, nextPage, {
                    start: parseDate(data.range.start),
                    end: parseDate(data.range.end)
                  })
                }}
                isLoading={loading}
              />
            </div>
          ) : null
        }
      >
        <TableHeader>
          <TableColumn>时间</TableColumn>
          <TableColumn>类型与原因</TableColumn>
          <TableColumn>变动</TableColumn>
          <TableColumn>变更后余额</TableColumn>
        </TableHeader>
        <TableBody
          items={data.records}
          emptyContent="所选日期内暂无萌萌点流水"
          isLoading={loading}
          loadingContent={<Spinner label="正在加载萌萌点流水" />}
        >
          {(record) => {
            const view = KIND_VIEW[record.kind]
            return (
              <TableRow key={record.id}>
                <TableCell>
                  <span className="whitespace-nowrap text-sm text-default-500">
                    {formatCreated(record.created)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="min-w-44 space-y-2">
                    <Chip color={view.color} variant="flat" size="sm">
                      {view.label}
                    </Chip>
                    {record.link ? (
                      <Link
                        as={NextLink}
                        href={record.link}
                        size="sm"
                        color="foreground"
                      >
                        {record.reason}
                      </Link>
                    ) : (
                      <p className="text-sm">{record.reason}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <DeltaGroup record={record} />
                </TableCell>
                <TableCell>
                  <BalanceSnapshot balance={record.balanceAfter} />
                </TableCell>
              </TableRow>
            )
          }}
        </TableBody>
      </Table>
    </section>
  )
}
