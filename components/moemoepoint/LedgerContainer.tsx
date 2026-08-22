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
import { KunLoading } from '~/components/kun/Loading'
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
// 没有约束; 意外值统一显示为「其他变动」, 不把内部值直接展示给用户。
const resolveKindView = (kind: string): KindView =>
  KIND_VIEW[kind as MoemoepointLedgerKind] ?? {
    label: '其他变动',
    color: 'default'
  }

const formatDelta = (value: number) => (value > 0 ? `+${value}` : String(value))

// 12px 小字用 -600/-500 而不是 DEFAULT 色阶: DEFAULT 是图标/深色模式的色阶,
// 放在正文小字上对比度不足。与仓库既有做法一致 (user/rating/Card.tsx:96)。
const deltaClassName = (value: number) =>
  value > 0
    ? 'text-success-600 dark:text-success-500'
    : value < 0
      ? 'text-danger-600 dark:text-danger-500'
      : 'text-default-500'

const balanceValueClassName = (value: number) =>
  value < 0 ? 'text-danger-600 dark:text-danger-500' : undefined

// 提到模块级: Intl.DateTimeFormat 构造开销大, 而移动端卡片和桌面表格
// 两棵子树始终同时挂载, 每次渲染会构造 2 × 行数 次。
//
// 这里刻意不用 utils/time.ts 的 formatDate: 那个函数在环境时区下格式化,
// 有 SSR/CSR 水合不一致风险; 固定 Asia/Shanghai 也和
// utils/moemoepointDateRange.ts 的自然日边界保持同一口径。
const LEDGER_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

const formatCreated = (value: string) =>
  LEDGER_DATE_FORMATTER.format(new Date(value))

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
    <CardBody className="flex flex-row items-center gap-4 p-4">
      <div className={`shrink-0 rounded-full bg-default-100 p-3 ${color}`}>
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-default-500">{label}</p>
        <p
          className={`text-2xl font-semibold tabular-nums ${balanceValueClassName(value) ?? ''
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
    {/* 待结算保持中性色: 被冻结既不是收益也不是损失, 染成 success/danger 会误导 */}
    <p className="text-default-500">
      待结算 {formatDelta(record.reservedDelta)}
    </p>
    <p className={deltaClassName(record.availableDelta)}>
      可用 {formatDelta(record.availableDelta)}
    </p>
  </div>
)

const BalanceSnapshot = ({ balance }: { balance: MoemoepointBalance }) => (
  <div className="space-y-1 text-xs tabular-nums text-default-500">
    <p className={balanceValueClassName(balance.total)}>总额 {balance.total}</p>
    <p>待结算 {balance.reserved}</p>
    <p className={balanceValueClassName(balance.available)}>
      可用 {balance.available}
    </p>
  </div>
)

const RecordReason = ({ record }: { record: MoemoepointLedgerEntry }) => {
  const view = resolveKindView(record.kind)
  return (
    // 必须是 flex-col: Chip 和 Link 的 base 都含 inline-flex, 放在 space-y-*
    // 的普通 div 里会挤在同一行且中间没有空格 (JSX 吃掉了纯换行空白)。
    // items-start 也必需, 否则 stretch 会和 Chip 的 max-w-fit 打架。
    <div className="flex flex-col items-start gap-2">
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
      {/* 两组数字的行标签完全相同, 窄屏没有列头可依靠, 必须自带小标题 */}
      <div className="flex justify-between gap-4">
        <div className="space-y-1">
          <p className="text-tiny text-default-400">变动</p>
          <DeltaGroup record={record} />
        </div>
        <div className="space-y-1 text-right">
          <p className="text-tiny text-default-400">变更后余额</p>
          <BalanceSnapshot balance={record.balanceAfter} />
        </div>
      </div>
    </CardBody>
  </Card>
)

export const MoemoepointLedgerContainer = ({
  userId,
  initialData,
  title = '萌萌点明细',
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
    // 管理员查看他人明细时不能覆盖自己顶栏的余额。
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
        setError('萌萌点明细加载失败，请稍后重试')
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
    : '所选日期内暂无萌萌点明细'
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
        endContent={
          <p className="whitespace-pre-wrap text-default-500">
            这里汇总了你在 OtoAme 全站的萌萌点收支记录。
          </p>
        }
        headerEndContent={
          showRulesLink ? (
            // 说明文字通过 endContent 独占下一行，避免其固有宽度挤压标题行；
            // shrink-0 + whitespace-nowrap 则确保窄屏规则链接始终保持一行。
            <Link
              as={NextLink}
              href="/moemoepoint/rules"
              size="sm"
              className="shrink-0 self-start whitespace-nowrap"
            >
              萌萌点规则
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <BalanceCard
          label="总萌萌点"
          value={data.balance.total}
          description="包含待结算的部分"
          icon={CircleDollarSign}
          color="text-primary"
        />
        <BalanceCard
          label="可用萌萌点"
          value={data.balance.available}
          description="可消费的部分"
          icon={WalletCards}
          color="text-success"
        />
        <BalanceCard
          label="待结算萌萌点"
          value={data.balance.reserved}
          description="暂时不能使用，等待返还或扣除"
          icon={Clock3}
          color="text-warning"
        />
      </div>

      <p className="text-sm text-default-500">
        可用萌萌点 = 总萌萌点 - 待结算萌萌点；消费和余额门槛以可用萌萌点为准。
      </p>

      {data.balance.total < 0 && (
        <Card>
          <CardBody className="text-sm text-danger">
            当前总萌萌点为负。通常是已经获得的奖励被收回（例如资源被删除或点赞被取消）。
            这笔回退会保留在明细里，之后获得的萌萌点会从当前总额继续累积。
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-4">
          <Tabs
            aria-label="萌萌点明细日期范围"
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
            <div className="space-y-2">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
                {/* HeroUI v2.8.1 没有把可见 label 转发给 React Aria；
                    同名 aria-label 保留真实的读屏名称并消除开发环境警告。 */}
                <DateRangePicker
                  className="max-w-xl"
                  aria-label="日期范围"
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
                />
                <Button
                  color="primary"
                  onPress={applyCustomRange}
                  isLoading={loading}
                >
                  查询
                </Button>
              </div>
              {/* 这段说明刻意不作为 DateRangePicker 的 description:
                  它的 helperWrapper 是占据高度的 flex 兄弟, 会让同一行
                  items-end 的「查询」按钮对齐到说明文字底部而不是输入框底部。 */}
              <p className="text-xs text-default-500">
                单次最多查询 {MAX_MOEMOEPOINT_CUSTOM_RANGE_DAYS} 天
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <div className="min-h-40">
          <KunLoading hint="正在加载萌萌点明细" />
        </div>
      ) : (
        <>
          <div className="space-y-3 sm:hidden">
            {records.length ? (
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
            <Table aria-label="萌萌点变动明细" classNames={{ td: 'align-top' }}>
              <TableHeader>
                <TableColumn>时间</TableColumn>
                <TableColumn>类型与原因</TableColumn>
                <TableColumn>本次变动</TableColumn>
                <TableColumn>变更后余额</TableColumn>
              </TableHeader>
              <TableBody items={records} emptyContent={emptyContent}>
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
        </>
      )}

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
