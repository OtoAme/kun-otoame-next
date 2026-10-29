'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import { cn } from '~/lib/dashboard/utils'
import type { StatsTrendData, StatsTrendMetric } from '~/types/api/admin'

type MetricKey = StatsTrendMetric

// Literal classes keep Tailwind's output; `stroke` feeds the SVG directly.
const METRICS: {
  key: MetricKey
  label: string
  stroke: string
  dot: string
}[] = [
  { key: 'newUser', label: '新注册用户', stroke: '#0ea5e9', dot: 'bg-sky-500' },
  { key: 'checkIn', label: '签到', stroke: '#06b6d4', dot: 'bg-cyan-500' },
  {
    key: 'resourceAccess',
    label: '资源获取',
    stroke: '#6366f1',
    dot: 'bg-indigo-500'
  },
  {
    key: 'newGalgame',
    label: '新增条目',
    stroke: '#8b5cf6',
    dot: 'bg-violet-500'
  },
  {
    key: 'newGalgameResource',
    label: '新增资源',
    stroke: '#10b981',
    dot: 'bg-emerald-500'
  },
  {
    key: 'newSubmission',
    label: '新投稿',
    stroke: '#14b8a6',
    dot: 'bg-teal-500'
  },
  {
    key: 'newComment',
    label: '新增评论',
    stroke: '#f59e0b',
    dot: 'bg-amber-500'
  },
  {
    key: 'newRating',
    label: '新增评价',
    stroke: '#f97316',
    dot: 'bg-orange-500'
  },
  { key: 'newCase', label: '新问题', stroke: '#f43f5e', dot: 'bg-rose-500' }
]

const shortDate = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

/**
 * Metric tabs over one daily area chart, after Cloudflare's analytics cards:
 * each tab shows the window total and selects the series drawn below. The
 * first tile is the window's login count, which has no daily series.
 */
export function DashboardTrend({ data }: { data: StatsTrendData }) {
  const [active, setActive] = useState<MetricKey>('newUser')
  const metric = METRICS.find((item) => item.key === active) ?? METRICS[0]
  const totals = Object.fromEntries(
    METRICS.map((item) => [
      item.key,
      data.points.reduce((sum, point) => sum + point[item.key], 0)
    ])
  ) as Record<MetricKey, number>
  const gradientId = `dashboard-trend-${metric.key}`

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
        {/* Logins have no per-day history: a figure, not a tab. */}
        <div className="flex flex-col items-start gap-0.5 bg-card px-3 py-2">
          <span className="text-xs text-muted-foreground">最近登录</span>
          <span className="text-lg font-semibold tabular-nums">
            {data.recentLogin.toLocaleString('zh-CN')}
          </span>
          <span className="text-[11px] leading-4 text-muted-foreground">
            按最后登录时间，无逐日记录
          </span>
        </div>
        <div role="tablist" aria-label="趋势指标" className="contents">
          {METRICS.map((item) => {
            const selected = item.key === active
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(item.key)}
                className={cn(
                  'flex flex-col items-start gap-0.5 bg-card px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                  selected && 'bg-accent'
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn('size-2 rounded-full', item.dot)}
                  />
                  {item.label}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {totals[item.key].toLocaleString('zh-CN')}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div
        className="h-48 w-full"
        role="img"
        aria-label={`${metric.label}逐日趋势，共 ${data.points.length} 天，合计 ${totals[metric.key]}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data.points}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={metric.stroke}
                  stopOpacity={0.35}
                />
                <stop offset="100%" stopColor={metric.stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              width={32}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{
                stroke: 'var(--muted-foreground)',
                strokeDasharray: '3 3'
              }}
              formatter={(value) => [value, metric.label]}
              labelFormatter={(label) => String(label)}
              contentStyle={{
                backgroundColor: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                color: 'var(--popover-foreground)',
                fontSize: '0.75rem'
              }}
              labelStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Area
              type="monotone"
              dataKey={metric.key}
              stroke={metric.stroke}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
