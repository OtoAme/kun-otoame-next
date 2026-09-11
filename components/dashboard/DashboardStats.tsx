'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ClipboardCheck,
  Flag,
  MessageSquare,
  PackagePlus,
  Sigma,
  Upload,
  UserPlus,
  type LucideIcon
} from 'lucide-react'

import { useDashboard } from '~/components/dashboard/DashboardShell'
import {
  OVERVIEW_DEFAULT_DAYS,
  OVERVIEW_MAX_DAYS,
  OVERVIEW_MIN_DAYS,
  useDashboardStats
} from '~/hooks/dashboard/useDashboardStats'
import { INBOX_KIND_LABELS } from '~/constants/dashboard'
import { cn } from '~/lib/dashboard/utils'
import { INBOX_KINDS } from '~/types/api/inbox'
import type { InboxCounts, InboxKind } from '~/types/api/inbox'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { Skeleton } from '~/components/dashboard/ui/skeleton'

export interface DashboardStatsProps {
  reviewerRole: number
}

const inboxGridClass =
  'grid grid-cols-2 gap-3 @lg/main:grid-cols-3 @3xl/main:grid-cols-4 @6xl/main:grid-cols-6'
const statsGridClass =
  'grid grid-cols-2 gap-3 @lg/main:grid-cols-3 @3xl/main:grid-cols-4 @6xl/main:grid-cols-5'

const compactCardClass = '@container/card min-w-0 gap-1.5 py-3 shadow-xs'
const compactCardHeaderClass = 'px-3.5'
const compactCardFooterClass =
  'px-3.5 text-xs break-words text-muted-foreground'

const INBOX_KIND_ICONS: Record<InboxKind, LucideIcon> = {
  submission: Upload,
  'resource-apply': PackagePlus,
  feedback: MessageSquare,
  report: Flag
}

const INBOX_KIND_BAR_CLASS: Record<InboxKind, string> = {
  submission: 'bg-sky-500',
  'resource-apply': 'bg-emerald-500',
  feedback: 'bg-amber-500',
  report: 'bg-rose-500'
}

const numberFormatter = new Intl.NumberFormat('zh-CN')

function SectionHeader(props: {
  id: string
  title: string
  note?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={props.id} className="text-lg font-semibold break-words">
          {props.title}
        </h2>
        {props.note ? (
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {props.note}
          </p>
        ) : null}
      </div>
      {props.action}
    </div>
  )
}

function StatValue({ value }: { value: number }) {
  return (
    <CardTitle className="text-xl font-semibold tabular-nums @[250px]/card:text-2xl">
      {numberFormatter.format(value)}
    </CardTitle>
  )
}

function StatCard(props: {
  label: string
  value: number
  caption?: string
  icon?: LucideIcon
}) {
  const Icon = props.icon
  return (
    <Card className={compactCardClass}>
      <CardHeader className={compactCardHeaderClass}>
        <CardDescription className="text-xs break-words">
          {props.label}
        </CardDescription>
        {Icon ? (
          <CardAction>
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardAction>
        ) : null}
        <StatValue value={props.value} />
      </CardHeader>
      {props.caption ? (
        <CardFooter className={compactCardFooterClass}>
          {props.caption}
        </CardFooter>
      ) : null}
    </Card>
  )
}

function StatCardSkeleton() {
  return (
    <Card className={compactCardClass} aria-hidden="true">
      <CardHeader className={compactCardHeaderClass}>
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-6 w-20" />
      </CardHeader>
    </Card>
  )
}

function RetryButton(props: { retrying: boolean; onRetry: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={props.retrying}
      onClick={props.onRetry}
    >
      重试
    </Button>
  )
}

function BlockError(props: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <Card className="min-w-0 py-4 shadow-xs">
      <CardContent className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm break-words text-destructive">
          {props.message}
        </p>
        <RetryButton retrying={props.retrying} onRetry={props.onRetry} />
      </CardContent>
    </Card>
  )
}

function InlineError(props: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm break-words text-destructive">
        {props.message}
      </p>
      <RetryButton retrying={props.retrying} onRetry={props.onRetry} />
    </div>
  )
}

function PendingDistribution({ counts }: { counts: InboxCounts }) {
  const total = INBOX_KINDS.reduce((sum, kind) => sum + counts.pending[kind], 0)
  return (
    <Card
      className="min-w-0 gap-2.5 py-3 shadow-xs"
      aria-labelledby="dashboard-pending-distribution-heading"
    >
      <CardHeader className={compactCardHeaderClass}>
        <CardTitle
          id="dashboard-pending-distribution-heading"
          className="text-sm font-medium"
        >
          当前待审分布
        </CardTitle>
        <CardDescription className="text-xs break-words">
          四类来源待审量占比，随计数一起刷新。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 px-3.5">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            当前没有待审事项，四类来源均为零。
          </p>
        ) : (
          <>
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              {INBOX_KINDS.map((kind) => {
                const value = counts.pending[kind]
                if (value <= 0) {
                  return null
                }
                return (
                  <div
                    key={kind}
                    className={INBOX_KIND_BAR_CLASS[kind]}
                    style={{ width: `${(value / total) * 100}%` }}
                  />
                )
              })}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 @lg/main:grid-cols-4">
              {INBOX_KINDS.map((kind) => {
                const value = counts.pending[kind]
                const percent = Math.round((value / total) * 100)
                return (
                  <li
                    key={kind}
                    className="flex min-w-0 items-center gap-1.5 text-xs"
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        INBOX_KIND_BAR_CLASS[kind]
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words text-muted-foreground">
                      {INBOX_KIND_LABELS[kind]}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {numberFormatter.format(value)} · {percent}%
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function DashboardStats({ reviewerRole }: DashboardStatsProps) {
  const { counts, countsLoading, countsError, refreshCounts } = useDashboard()
  const { canViewStats, summary, overview, days, loadSummary, loadOverview } =
    useDashboardStats(reviewerRole)

  const [daysInput, setDaysInput] = useState(String(OVERVIEW_DEFAULT_DAYS))
  const [daysError, setDaysError] = useState('')

  // Reflect the actually applied window (a role downgrade resets it).
  useEffect(() => {
    setDaysInput(String(days))
  }, [days])

  const handleDaysSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = daysInput.trim()
    const parsed = /^\d+$/.test(trimmed)
      ? Number.parseInt(trimmed, 10)
      : Number.NaN
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

  const pendingTotal = counts
    ? INBOX_KINDS.reduce((total, kind) => total + counts.pending[kind], 0)
    : 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto @container/main">
      <div className="flex w-full min-w-0 flex-col gap-8 p-4 md:p-6">
        <section
          aria-labelledby="dashboard-inbox-heading"
          className="flex min-w-0 flex-col gap-4"
        >
          <SectionHeader
            id="dashboard-inbox-heading"
            title="待审事项"
            note="按类别查看和处理待审事项。"
          />
          {countsLoading && !counts ? (
            <div className={inboxGridClass}>
              {Array.from({ length: canViewStats ? 7 : 6 }).map((_, index) => (
                <StatCardSkeleton key={index} />
              ))}
            </div>
          ) : counts ? (
            <>
              {countsError ? (
                <InlineError
                  message={countsError}
                  retrying={countsLoading}
                  onRetry={() => void refreshCounts()}
                />
              ) : null}
              <div className={inboxGridClass}>
                {INBOX_KINDS.map((kind) => {
                  const KindIcon = INBOX_KIND_ICONS[kind]
                  return (
                    <Link
                      key={kind}
                      href={`/dashboard/inbox?kinds=${kind}`}
                      className="min-w-0"
                    >
                      <Card
                        className={cn(
                          compactCardClass,
                          'h-full transition-colors hover:bg-accent/50'
                        )}
                      >
                        <CardHeader className={compactCardHeaderClass}>
                          <CardDescription className="text-xs break-words">
                            {INBOX_KIND_LABELS[kind]}
                          </CardDescription>
                          <CardAction>
                            <KindIcon
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          </CardAction>
                          <StatValue value={counts.pending[kind]} />
                        </CardHeader>
                      </Card>
                    </Link>
                  )
                })}
                <StatCard
                  label="合计"
                  value={pendingTotal}
                  caption="仅统计以上四类来源"
                  icon={Sigma}
                />
                <StatCard
                  label="我今日已处理"
                  value={counts.todayProcessed}
                  caption="我在上海自然日内已完成的审核动作"
                  icon={ClipboardCheck}
                />
                {canViewStats ? (
                  <Link
                    href="/admin/creator"
                    prefetch={false}
                    className="min-w-0"
                  >
                    <Card
                      className={cn(
                        compactCardClass,
                        'h-full transition-colors hover:bg-accent/50'
                      )}
                    >
                      <CardHeader className={compactCardHeaderClass}>
                        <CardDescription className="text-xs break-words">
                          待审创作者申请
                        </CardDescription>
                        <CardAction>
                          <UserPlus
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </CardAction>
                        {summary.data ? (
                          <StatValue
                            value={summary.data.pendingCreatorApplyCount}
                          />
                        ) : summary.error ? (
                          <CardTitle className="text-sm font-normal text-destructive">
                            加载失败
                          </CardTitle>
                        ) : (
                          <Skeleton className="h-6 w-20" />
                        )}
                      </CardHeader>
                      <CardFooter className={compactCardFooterClass}>
                        独立项目，不计入合计
                      </CardFooter>
                    </Card>
                  </Link>
                ) : null}
              </div>
              <PendingDistribution counts={counts} />
            </>
          ) : (
            <BlockError
              message={countsError || '获取待办计数失败'}
              retrying={countsLoading}
              onRetry={() => void refreshCounts()}
            />
          )}
        </section>

        {canViewStats ? (
          <>
            <section
              aria-labelledby="dashboard-sum-heading"
              className="flex min-w-0 flex-col gap-4"
            >
              <SectionHeader
                id="dashboard-sum-heading"
                title="总量统计"
                note="数据库现存记录总量，资源包含所有状态。"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={summary.loading}
                    onClick={() => void loadSummary()}
                  >
                    刷新
                  </Button>
                }
              />
              {!summary.data && !summary.error ? (
                <div className={statsGridClass}>
                  {Array.from({ length: 9 }).map((_, index) => (
                    <StatCardSkeleton key={index} />
                  ))}
                </div>
              ) : summary.data ? (
                <>
                  {summary.error ? (
                    <InlineError
                      message={summary.error}
                      retrying={summary.loading}
                      onRetry={() => void loadSummary()}
                    />
                  ) : null}
                  <div className={statsGridClass}>
                    <StatCard label="用户总数" value={summary.data.userCount} />
                    <StatCard
                      label="条目总数"
                      value={summary.data.galgameCount}
                    />
                    <StatCard
                      label="游戏资源总数"
                      value={summary.data.galgameResourceCount}
                    />
                    <StatCard
                      label="补丁资源总数"
                      value={summary.data.galgamePatchResourceCount}
                    />
                    <StatCard
                      label="评论总数"
                      value={summary.data.galgameCommentCount}
                    />
                    <StatCard
                      label="评分总数"
                      value={summary.data.ratingCount}
                    />
                    <StatCard
                      label="投稿总数"
                      value={summary.data.submissionCount}
                    />
                    <StatCard
                      label="创作者数"
                      value={summary.data.creatorCount}
                      caption="当前创作者，不含管理员"
                    />
                    <StatCard
                      label="待审创作者申请数"
                      value={summary.data.pendingCreatorApplyCount}
                    />
                  </div>
                </>
              ) : (
                <BlockError
                  message={summary.error || '获取总量统计失败'}
                  retrying={summary.loading}
                  onRetry={() => void loadSummary()}
                />
              )}
            </section>

            <section
              aria-labelledby="dashboard-overview-heading"
              className="flex min-w-0 flex-col gap-4"
            >
              <SectionHeader
                id="dashboard-overview-heading"
                title="近期统计"
                note={`最近 ${days} 天滚动窗口（非自然日）。`}
                action={
                  <form
                    onSubmit={handleDaysSubmit}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Input
                      aria-label="统计天数"
                      inputMode="numeric"
                      placeholder={`${OVERVIEW_MIN_DAYS}-${OVERVIEW_MAX_DAYS}`}
                      className="w-24"
                      value={daysInput}
                      onChange={(event) => setDaysInput(event.target.value)}
                    />
                    <Button type="submit" size="sm" disabled={overview.loading}>
                      查询
                    </Button>
                  </form>
                }
              />
              {daysError ? (
                <p
                  role="alert"
                  className="text-sm break-words text-destructive"
                >
                  {daysError}
                </p>
              ) : null}
              {!overview.data && !overview.error ? (
                <div className={statsGridClass}>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <StatCardSkeleton key={index} />
                  ))}
                </div>
              ) : overview.data ? (
                <>
                  {overview.error ? (
                    <InlineError
                      message={overview.error}
                      retrying={overview.loading}
                      onRetry={() => void loadOverview(days)}
                    />
                  ) : null}
                  <div className={statsGridClass}>
                    <StatCard
                      label="新注册用户"
                      value={overview.data.newUser}
                    />
                    <StatCard
                      label="最近登录人数"
                      value={overview.data.newActiveUser}
                      caption="最近一次登录落在窗口内，非每日活跃事件"
                    />
                    <StatCard
                      label="新增条目"
                      value={overview.data.newGalgame}
                    />
                    <StatCard
                      label="新增资源"
                      value={overview.data.newGalgameResource}
                    />
                    <StatCard
                      label="新增评论"
                      value={overview.data.newComment}
                    />
                  </div>
                </>
              ) : (
                <BlockError
                  message={overview.error || '获取近期统计失败'}
                  retrying={overview.loading}
                  onRetry={() => void loadOverview(days)}
                />
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
