'use client'

import { cloneElement, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Button } from '@heroui/button'
import { Select, SelectItem } from '@heroui/select'
import 'react-activity-calendar/tooltips.css'
import { ActivityCalendar } from 'react-activity-calendar'
import type { Activity } from 'react-activity-calendar'
import { KunLoading } from '~/components/kun/Loading'
import { kunFetchGet } from '~/utils/kunFetch'

const colors = [
  'hsl(var(--heroui-default-100))',
  'hsl(var(--kun-brand-200))',
  'hsl(var(--kun-brand-400))',
  'hsl(var(--kun-brand-500))',
  'hsl(var(--kun-brand-700))'
]
const theme = { light: colors, dark: colors }
const labels = {
  months: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
  legend: { less: '少', more: '多' },
  totalCount: '{{year}} 年共 {{count}} 次贡献'
}

const contributionText = ({ count }: Activity) =>
  `${count} contribution${count === 1 ? '' : 's'}`
const tooltips = { activity: { text: contributionText } }

const navigateDays = (event: KeyboardEvent<HTMLDivElement>) => {
  const offset = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[
    event.key
  ]
  if (!offset || !(event.target instanceof SVGElement)) return
  const cells = Array.from(
    event.currentTarget.querySelectorAll<SVGRectElement>('rect[data-date]')
  )
  const index = cells.indexOf(event.target as SVGRectElement)
  if (index < 0) return
  event.preventDefault()
  const next = cells[index + offset]
  if (next) {
    cells[index].setAttribute('tabindex', '-1')
    next.setAttribute('tabindex', '0')
    next.focus()
  }
}

function YearCalendar({ uid, year }: { uid: number; year?: number }) {
  const [days, setDays] = useState<Activity[] | null>(null)
  const [focusedDay, setFocusedDay] = useState('')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    kunFetchGet<Activity[]>(
      '/user/profile/contributions',
      year === undefined ? { uid } : { uid, year },
      { signal: controller.signal, preserveErrorStatus: true }
    )
      .then((data) => {
        if (!controller.signal.aborted) setDays(data)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [uid, year, attempt])

  if (failed)
    return (
      <div
        className="flex min-h-32 items-center justify-center gap-2"
        role="alert"
      >
        贡献记录加载失败
        <Button
          size="sm"
          variant="light"
          onPress={() => {
            setFailed(false)
            setAttempt(attempt + 1)
          }}
        >
          重试
        </Button>
      </div>
    )
  if (!days) return <KunLoading hint="正在加载贡献记录..." />

  return (
    <div
      className="relative min-w-0"
      onKeyDown={navigateDays}
      onBlur={() => setFocusedDay('')}
    >
      <ActivityCalendar
        data={days}
        theme={theme}
        labels={
          year === undefined
            ? { ...labels, totalCount: '最近一年共 {{count}} 次贡献' }
            : labels
        }
        blockSize={11}
        blockMargin={3}
        fontSize={12}
        tooltips={tooltips}
        renderBlock={(block, activity) => {
          const description = `${activity.date}, ${contributionText(activity)}`
          return cloneElement(block, {
            tabIndex: activity.date === days[0].date ? 0 : -1,
            role: 'img',
            'aria-label': description,
            onFocus: (event) => {
              if (event.currentTarget.matches(':focus-visible'))
                setFocusedDay(description)
            },
            className: 'focus-visible:outline-primary'
          })
        }}
      />
      {focusedDay && (
        <span className="pointer-events-none absolute right-0 top-0 rounded-small bg-content2 px-2 text-xs">
          {focusedDay}
        </span>
      )}
    </div>
  )
}

export function UserContributions({
  uid,
  firstYear,
  currentYear
}: {
  uid: number
  firstYear: number
  currentYear: number
}) {
  const [period, setPeriod] = useState('recent')
  const years = Array.from(
    { length: currentYear - Math.min(firstYear, currentYear) + 1 },
    (_, i) => currentYear - i
  )
  return (
    <Card>
      <CardHeader className="justify-between gap-4 px-4 pb-1">
        <h2 className="text-lg font-semibold">贡献热力图</h2>
        <Select
          aria-label="贡献年份"
          disallowEmptySelection
          size="sm"
          className="w-28"
          selectedKeys={[period]}
          onChange={(event) => {
            if (event.target.value) setPeriod(event.target.value)
          }}
        >
          {['recent', ...years].map((item) => (
            <SelectItem key={item}>
              {item === 'recent' ? '最近一年' : String(item)}
            </SelectItem>
          ))}
        </Select>
      </CardHeader>
      <CardBody className="p-4">
        <YearCalendar
          key={period}
          uid={uid}
          year={period === 'recent' ? undefined : Number(period)}
        />
      </CardBody>
    </Card>
  )
}
