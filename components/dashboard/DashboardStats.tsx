'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  BadgeCheck,
  ClipboardList,
  FileText,
  Flag,
  Globe,
  Merge,
  MessageSquare,
  Package,
  RefreshCw,
  Unlink,
  UserPlus,
  type LucideIcon
} from 'lucide-react'

import { useDashboard } from '~/components/dashboard/DashboardShell'
import { DashboardPanel } from '~/components/dashboard/page/DashboardPage'
import {
  OVERVIEW_DEFAULT_DAYS,
  OVERVIEW_MAX_DAYS,
  OVERVIEW_MIN_DAYS,
  useDashboardStats,
  type StatsBlock
} from '~/hooks/dashboard/useDashboardStats'
import {
  LOG_MIN_ROLE,
  useOverviewPanels
} from '~/hooks/dashboard/useOverviewPanels'
import { useElementWidth } from '~/hooks/dashboard/useElementWidth'
import { ADMIN_LOG_TYPE_MAP } from '~/constants/admin'
import { LINK_HEALTH_INBOX_KIND_LABELS } from '~/constants/dashboard'
import { cn } from '~/lib/dashboard/utils'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  LINK_HEALTH_INBOX_KINDS,
  type InboxItem,
  type LinkHealthInboxKind
} from '~/types/api/inbox'
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Badge } from '~/components/dashboard/ui/badge'

export interface DashboardStatsProps {
  reviewerRole: number
}

const numberFormatter = new Intl.NumberFormat('zh-CN')
const fmt = (value: number) => numberFormatter.format(value)

type QueueKey = LinkHealthInboxKind | 'creator' | 'company-merge'

interface QueueTone {
  icon: LucideIcon
  tile: string
  bar: string
}

// Literal class names so Tailwind keeps them; tile = tinted icon background.
const QUEUE_TONES: Record<QueueKey, QueueTone> = {
  submission: {
    icon: FileText,
    tile: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
    bar: 'bg-sky-500'
  },
  'resource-apply': {
    icon: Package,
    tile: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500'
  },
  feedback: {
    icon: MessageSquare,
    tile: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500'
  },
  report: {
    icon: Flag,
    tile: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    bar: 'bg-rose-500'
  },
  case: {
    icon: ClipboardList,
    tile: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    bar: 'bg-violet-500'
  },
  'broken-link': {
    icon: Unlink,
    tile: 'bg-slate-500/12 text-slate-600 dark:text-slate-400',
    bar: 'bg-slate-500'
  },
  creator: {
    icon: BadgeCheck,
    tile: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
    bar: 'bg-orange-500'
  },
  'company-merge': {
    icon: Merge,
    tile: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',
    bar: 'bg-teal-500'
  }
}

function formatWaiting(seconds: number): string {
  if (seconds < 60) return '不足 1 分钟'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days} 天 ${hours % 24} 小时` : `${days} 天`
}

const waitingTone = (seconds: number) =>
  seconds >= 72 * 3600
    ? 'font-semibold text-destructive'
    : seconds >= 24 * 3600
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-muted-foreground'

function Panel(props: {
  id: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <DashboardPanel>
      <section aria-labelledby={props.id}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3.5">
          <h2 id={props.id} className="text-sm font-semibold">
            {props.title}
          </h2>
          {props.description && (
            <span className="text-xs text-muted-foreground">
              {props.description}
            </span>
          )}
          {props.action && (
            <div className="ml-auto flex items-center gap-2">
              {props.action}
            </div>
          )}
        </div>
        <div className="px-4 pt-2.5 pb-4">{props.children}</div>
      </section>
    </DashboardPanel>
  )
}

function PanelError(props: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm break-words text-destructive">
        {props.message}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.retrying}
        onClick={props.onRetry}
      >
        重试
      </Button>
    </div>
  )
}

/** Renders a block's data, a skeleton before first load, or its error. */
function BlockBody<T>(props: {
  block: StatsBlock<T>
  onRetry: () => void
  skeleton: ReactNode
  children: (data: T) => ReactNode
}) {
  const { block } = props
  if (block.data !== null) {
    return (
      <>
        {block.error && (
          <div className="mb-3">
            <PanelError
              message={block.error}
              retrying={block.loading}
              onRetry={props.onRetry}
            />
          </div>
        )}
        {props.children(block.data)}
      </>
    )
  }
  if (block.error) {
    return (
      <PanelError
        message={block.error}
        retrying={block.loading}
        onRetry={props.onRetry}
      />
    )
  }
  return <>{props.skeleton}</>
}

interface QueueRow {
  key: QueueKey
  label: string
  note?: string
  href: string
  value: number | null
  error?: string
}

function QueueList({ rows }: { rows: QueueRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0))
  return (
    <ul className="-mx-2 flex flex-col">
      {rows.map((row) => {
        const tone = QUEUE_TONES[row.key]
        const Icon = tone.icon
        const empty = row.value === 0
        return (
          <li key={row.key}>
            <Link
              href={row.href}
              prefetch={false}
              className={cn(
                'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                empty && 'opacity-60'
              )}
            >
              <span
                className={cn(
                  'row-span-2 flex size-10 items-center justify-center rounded-lg',
                  tone.tile
                )}
                aria-hidden="true"
              >
                <Icon className="size-[22px]" />
              </span>
              <span className="min-w-0 text-sm font-medium">
                {row.label}
                {row.note && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {row.note}
                  </span>
                )}
              </span>
              <span className="text-right text-lg font-semibold tabular-nums">
                {row.value !== null ? (
                  fmt(row.value)
                ) : row.error ? (
                  <span className="text-xs font-normal text-destructive">
                    读取失败
                  </span>
                ) : (
                  <Skeleton className="ml-auto h-5 w-8" />
                )}
              </span>
              <span
                className="col-span-2 col-start-2 mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <span
                  className={cn('block h-full', tone.bar)}
                  style={{ width: `${((row.value ?? 0) / max) * 100}%` }}
                />
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function OldestList({ items }: { items: InboxItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        收件箱已清空，没有等待处理的事项。
      </p>
    )
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((item) => {
        const tone = QUEUE_TONES[item.kind]
        const Icon = tone.icon
        return (
          <li key={item.key}>
            <Link
              href={`/dashboard/inbox?kind=${item.kind}&id=${item.id}`}
              prefetch={false}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span
                className={cn(
                  'row-span-2 flex size-7 items-center justify-center rounded-md',
                  tone.tile
                )}
                aria-hidden="true"
              >
                <Icon className="size-4" />
              </span>
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span
                className={cn(
                  'row-span-2 text-right text-xs whitespace-nowrap tabular-nums',
                  waitingTone(item.waitingSeconds)
                )}
              >
                已等 {formatWaiting(item.waitingSeconds)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {LINK_HEALTH_INBOX_KIND_LABELS[item.kind]}
                {item.actor ? ` · ${item.actor.name}` : ''}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function Metric(props: { label: string; value: number; caption?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{fmt(props.value)}</dd>
      {props.caption && (
        <dd className="text-xs text-muted-foreground">{props.caption}</dd>
      )}
    </div>
  )
}

const metricSkeleton = (count: number) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-3.5" aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-6 w-20" />
      </div>
    ))}
  </div>
)

const listSkeleton = (count: number) => (
  <div className="flex flex-col gap-3" aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <Skeleton key={index} className="h-9 w-full" />
    ))}
  </div>
)

function SummaryCell(props: {
  label: string
  value: ReactNode
  caption: string
}) {
  return (
    <div className="min-w-0 bg-card px-5 py-3.5">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="mt-0.5 text-3xl leading-tight font-semibold tabular-nums">
        {props.value}
      </p>
      <p className="text-xs text-muted-foreground">{props.caption}</p>
    </div>
  )
}

export function DashboardStats({ reviewerRole }: DashboardStatsProps) {
  const { counts, countsLoading, countsError, refreshCounts } = useDashboard()
  const { canViewStats, summary, overview, days, loadSummary, loadOverview } =
    useDashboardStats(reviewerRole)
  const panels = useOverviewPanels(reviewerRole)
  const canViewLogs = reviewerRole >= LOG_MIN_ROLE
  const [daysInput, setDaysInput] = useState(String(OVERVIEW_DEFAULT_DAYS))
  const [daysError, setDaysError] = useState('')
  const [layoutRef, width] = useElementWidth<HTMLDivElement>()

  useEffect(() => {
    setDaysInput(String(days))
  }, [days])

  const handleDaysSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const raw = daysInput.trim()
    const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
    if (
      !Number.isInteger(parsed) ||
      parsed < OVERVIEW_MIN_DAYS ||
      parsed > OVERVIEW_MAX_DAYS
    ) {
      setDaysError(
        `请输入 ${OVERVIEW_MIN_DAYS} 到 ${OVERVIEW_MAX_DAYS} 之间的整数天数`
      )
      return
    }
    setDaysError('')
    void loadOverview(parsed)
  }

  const refreshAll = () => {
    void refreshCounts()
    panels.refreshAll()
    if (canViewStats) {
      void loadSummary()
      void loadOverview(days)
    }
  }

  const inboxTotal = counts
    ? LINK_HEALTH_INBOX_KINDS.reduce(
        (sum, kind) => sum + counts.pending[kind],
        0
      )
    : null

  const queueRows: QueueRow[] = [
    ...LINK_HEALTH_INBOX_KINDS.map(
      (kind): QueueRow => ({
        key: kind,
        label: LINK_HEALTH_INBOX_KIND_LABELS[kind],
        href: `/dashboard/inbox?kinds=${kind}`,
        value: counts ? counts.pending[kind] : null,
        error: counts ? undefined : countsError
      })
    ),
    // Creator applications are a separate queue, never part of the inbox total.
    {
      key: 'creator',
      label: '创作者申请',
      note: '独立页面',
      href: '/dashboard/creator',
      value: panels.creatorCount.data,
      error: panels.creatorCount.error
    },
    {
      key: 'company-merge',
      label: '会社合并建议',
      note: '独立页面',
      href: '/dashboard/company-merges',
      value: panels.mergeCount.data,
      error: panels.mergeCount.error
    }
  ]

  const queuePanel = (
    <Panel
      key="queue"
      id="dashboard-queue-heading"
      title="待办队列"
      description="点一行进入"
    >
      {countsError && (
        <div className="mb-3">
          <PanelError
            message={countsError}
            retrying={countsLoading}
            onRetry={() => void refreshCounts()}
          />
        </div>
      )}
      <QueueList rows={queueRows} />
    </Panel>
  )

  const oldestPanel = (
    <Panel
      key="oldest"
      id="dashboard-oldest-heading"
      title="最早的待审"
      description="收件箱内按等待时长"
      action={
        <Link
          href="/dashboard/inbox"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          全部
        </Link>
      }
    >
      <BlockBody
        block={panels.oldest}
        onRetry={() => void panels.loadOldest()}
        skeleton={listSkeleton(5)}
      >
        {(items) => <OldestList items={items} />}
      </BlockBody>
    </Panel>
  )

  const scalePanel = canViewStats && (
    <Panel
      key="scale"
      id="dashboard-sum-heading"
      title="站点规模"
      description="现存记录数，资源包含各状态"
    >
      <BlockBody
        block={summary}
        onRetry={() => void loadSummary()}
        skeleton={metricSkeleton(8)}
      >
        {(data) => (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Metric label="用户" value={data.userCount} />
            <Metric label="条目" value={data.galgameCount} />
            <Metric label="游戏资源" value={data.galgameResourceCount} />
            <Metric label="补丁资源" value={data.galgamePatchResourceCount} />
            <Metric label="评论" value={data.galgameCommentCount} />
            <Metric label="评分" value={data.ratingCount} />
            <Metric label="投稿" value={data.submissionCount} />
            <Metric
              label="创作者"
              value={data.creatorCount}
              caption="不含管理员"
            />
          </dl>
        )}
      </BlockBody>
    </Panel>
  )

  const growthPanel = canViewStats && (
    <Panel
      key="growth"
      id="dashboard-overview-heading"
      title="近期增长"
      description={`最近 ${days} 天滚动窗口`}
      action={
        <form onSubmit={handleDaysSubmit} className="flex items-center gap-1.5">
          <Input
            aria-label="统计天数"
            inputMode="numeric"
            placeholder={`${OVERVIEW_MIN_DAYS}-${OVERVIEW_MAX_DAYS}`}
            className="h-8 w-16"
            value={daysInput}
            onChange={(event) => setDaysInput(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={overview.loading}
          >
            天
          </Button>
        </form>
      }
    >
      {daysError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {daysError}
        </p>
      )}
      <BlockBody
        block={overview}
        onRetry={() => void loadOverview(days)}
        skeleton={metricSkeleton(5)}
      >
        {(data) => (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Metric label="新注册用户" value={data.newUser} />
              <Metric label="最近登录" value={data.newActiveUser} />
              <Metric label="新增条目" value={data.newGalgame} />
              <Metric label="新增资源" value={data.newGalgameResource} />
              <Metric label="新增评论" value={data.newComment} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              最近登录按最后一次登录时间统计，不是每日活跃人数。
            </p>
          </>
        )}
      </BlockBody>
    </Panel>
  )

  const statusPanel = canViewStats && (
    <Panel
      key="status"
      id="dashboard-status-heading"
      title="站点状态"
      action={
        <a
          href="/dashboard/setting"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          设置
        </a>
      }
    >
      <BlockBody
        block={panels.settings}
        onRetry={() => void panels.loadSettings()}
        skeleton={listSkeleton(2)}
      >
        {(data) => (
          <ul className="flex flex-col divide-y text-sm">
            <li className="flex items-center gap-2.5 py-2 first:pt-0">
              <UserPlus className="size-4 text-muted-foreground" />
              注册
              <Badge
                variant="outline"
                className={cn(
                  'ml-auto',
                  data.disableRegister
                    ? 'border-amber-600/40 text-amber-700 dark:text-amber-400'
                    : 'border-green-600/40 text-green-700 dark:text-green-400'
                )}
              >
                {data.disableRegister ? '已关闭' : '开放'}
              </Badge>
            </li>
            <li className="flex items-center gap-2.5 py-2 last:pb-0">
              <Globe className="size-4 text-muted-foreground" />
              域名重定向
              <Badge variant="outline" className="ml-auto">
                {data.redirect.enableRedirect ? '已开启' : '未开启'}
              </Badge>
            </li>
          </ul>
        )}
      </BlockBody>
    </Panel>
  )

  const logPanel = canViewLogs && (
    <Panel
      key="log"
      id="dashboard-log-heading"
      title="最近管理操作"
      action={
        <a
          href="/dashboard/log"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          全部日志
        </a>
      }
    >
      <BlockBody
        block={panels.logs}
        onRetry={() => void panels.loadLogs()}
        skeleton={listSkeleton(6)}
      >
        {(logs) =>
          logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有管理操作。</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {logs.map((log) => (
                <li key={log.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium">{log.user.name}</span>
                    <Badge variant="secondary">
                      {ADMIN_LOG_TYPE_MAP[log.type] ?? log.type}
                    </Badge>
                    <time className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {formatChinaDateTime(log.created)}
                    </time>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground">
                    {log.content}
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </BlockBody>
    </Panel>
  )

  // Columns are added as the content area widens (requirement 3.2); each
  // column stacks its own panels so short panels do not leave gaps.
  const present = (...nodes: Array<ReactNode | false>) =>
    nodes.filter((node): node is ReactNode => Boolean(node))
  const columns: ReactNode[][] = !canViewStats
    ? width >= 1024
      ? [[queuePanel], [oldestPanel], present(logPanel)]
      : width >= 768
        ? [[queuePanel], present(oldestPanel, logPanel)]
        : [present(queuePanel, oldestPanel, logPanel)]
    : width >= 1440
      ? [
          [queuePanel],
          present(oldestPanel, statusPanel),
          present(scalePanel, growthPanel),
          present(logPanel)
        ]
      : width >= 1024
        ? [
            present(queuePanel, statusPanel),
            present(oldestPanel, growthPanel),
            present(scalePanel, logPanel)
          ]
        : width >= 768
          ? [
              present(queuePanel, scalePanel, statusPanel),
              present(oldestPanel, growthPanel, logPanel)
            ]
          : [
              present(
                queuePanel,
                oldestPanel,
                scalePanel,
                growthPanel,
                statusPanel,
                logPanel
              )
            ]
  const visibleColumns = columns.filter((column) => column.length > 0)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div
        ref={layoutRef}
        className="flex w-full min-w-0 flex-col gap-4 px-4 py-4 md:px-6 md:py-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold md:text-xl">总览</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={refreshAll}
          >
            <RefreshCw />
            刷新全部
          </Button>
        </div>

        {/* Hairline grid: the 1px gaps show the border colour, so dividers stay
            correct when the cells wrap to two rows on narrow screens. */}
        <DashboardPanel className="overflow-hidden">
          <div
            className="grid gap-px bg-border"
            style={{
              gridTemplateColumns: `repeat(${
                width > 0 && width < 640 ? 2 : canViewStats ? 4 : 2
              }, minmax(0, 1fr))`
            }}
          >
            <SummaryCell
              label="待审事项"
              value={inboxTotal !== null ? fmt(inboxTotal) : '–'}
              caption={
                canViewStats
                  ? '收件箱六类合计；创作者申请、会社合并另列'
                  : '收件箱六类合计；会社合并另列'
              }
            />
            <SummaryCell
              label="我今日已处理"
              value={counts ? fmt(counts.todayProcessed) : '–'}
              caption="上海时间自然日"
            />
            {canViewStats && (
              <>
                <SummaryCell
                  label={`新注册 · 近 ${days} 天`}
                  value={overview.data ? fmt(overview.data.newUser) : '–'}
                  caption="滚动窗口"
                />
                <SummaryCell
                  label={`新增资源 · 近 ${days} 天`}
                  value={
                    overview.data ? fmt(overview.data.newGalgameResource) : '–'
                  }
                  caption="含各状态"
                />
              </>
            )}
          </div>
        </DashboardPanel>

        <div
          className="grid items-start gap-4"
          style={{
            gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))`
          }}
        >
          {visibleColumns.map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-4">
              {column}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
