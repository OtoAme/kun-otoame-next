'use client'

import { useEffect, useId, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import { useReducedMotion } from '~/hooks/dashboard/use-reduced-motion'
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
  {
    key: 'dailyLogin',
    label: '最近登录',
    stroke: '#64748b',
    dot: 'bg-slate-500'
  },
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

// Fast start, long gentle settle (an "ease-out quint"). Recharts' own
// 'ease-out' is (0.42, 0, 0.58, 1), close to symmetric, which reads as slow
// and linear. Its runtime accepts any cubic-bezier; the types only list the
// presets, hence the cast.
const ANIMATION_MS = 450
const ANIMATION_CURVE = '0.22, 1, 0.36, 1'
const ANIMATION_EASING = `cubic-bezier(${ANIMATION_CURVE})` as 'ease-out'
// The first draw reveals the whole curve left to right; at the switch speed it
// is over before the eye follows it, so it gets more time and a gentler
// "ease-in-out" curve that sweeps evenly instead of jumping to the end.
const REVEAL_MS = 1100
const REVEAL_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)' as 'ease-out'

const shortDate = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

/**
 * Metric tabs over one daily area chart, after Cloudflare's analytics cards:
 * each tab shows the window total and selects the series drawn below. The
 * login tab's figure is the window's distinct users (one person active on
 * several days counts once); its curve is the per-day count.
 *
 * The area is revealed left to right when it is drawn. Switching metrics or
 * refreshing the window keeps the same Area, so Recharts morphs the line from
 * the old points to the new ones instead of redrawing. A new window remounts
 * the chart (the skeleton shows while it loads), so it is revealed again.
 * Reduced motion turns all of it off.
 *
 * The overview owns the selected metric so a new window does not bounce the
 * chart back to the default tab while it remounts.
 */
export function DashboardTrend({
  data,
  firstEntry = true,
  metric: metricProp,
  onMetricChange
}: {
  data: StatsTrendData
  /**
   * Whether this is the first chart of the visit, read when the chart
   * mounts. Only that one gets the slower reveal; a chart remounted for a new
   * window draws at the quick switching speed.
   */
  firstEntry?: boolean
  /**
   * The metric to select. While the parent passes one it owns the selection;
   * a new value takes effect after the user's own clicks, matching a
   * controlled input. The first tab is the default.
   */
  metric?: MetricKey
  /** Called when the user picks a tab. */
  onMetricChange?: (metric: MetricKey) => void
}) {
  const [active, setActive] = useState<MetricKey>(metricProp ?? 'dailyLogin')
  useEffect(() => {
    if (metricProp) setActive(metricProp)
  }, [metricProp])
  const reducedMotion = useReducedMotion()
  // The slower reveal belongs to the points drawn first; new points or a
  // metric change take the quick speed. Recharts restarts its animation
  // several times while the chart's layout settles on mount, and every
  // restart calls onAnimationEnd, so that callback cannot end the reveal.
  const [revealPoints, setRevealPoints] = useState(
    firstEntry ? data.points : null
  )
  const revealing = revealPoints === data.points
  const selectMetric = (key: MetricKey) => {
    setRevealPoints(null)
    setActive(key)
    onMetricChange?.(key)
  }
  const metric = METRICS.find((item) => item.key === active) ?? METRICS[0]
  const totals = Object.fromEntries(
    METRICS.map((item) => [
      item.key,
      item.key === 'dailyLogin'
        ? data.recentLogin
        : data.points.reduce((sum, point) => sum + point[item.key], 0)
    ])
  ) as Record<MetricKey, number>
  // One gradient whose stops change colour, so the fill fades between
  // metrics. The line itself is remounted per animation and takes its new
  // colour at once; only its shape morphs.
  const gradientId = useId()
  const colorTransition = reducedMotion
    ? undefined
    : `stop-color ${ANIMATION_MS}ms cubic-bezier(${ANIMATION_CURVE})`

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
        <div role="tablist" aria-label="趋势指标" className="contents">
          {METRICS.map((item) => {
            const selected = item.key === active
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectMetric(item.key)}
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
        aria-label={
          metric.key === 'dailyLogin'
            ? `每日登录人数趋势，共 ${data.points.length} 天，窗口内 ${totals.dailyLogin} 人`
            : `${metric.label}逐日趋势，共 ${data.points.length} 天，合计 ${totals[metric.key]}`
        }
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
                  style={{ transition: colorTransition }}
                />
                <stop
                  offset="100%"
                  stopColor={metric.stroke}
                  stopOpacity={0}
                  style={{ transition: colorTransition }}
                />
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
              formatter={(value) => [
                value,
                metric.key === 'dailyLogin' ? '当日登录' : metric.label
              ]}
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
              isAnimationActive={!reducedMotion}
              animationDuration={revealing ? REVEAL_MS : ANIMATION_MS}
              animationEasing={revealing ? REVEAL_EASING : ANIMATION_EASING}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
