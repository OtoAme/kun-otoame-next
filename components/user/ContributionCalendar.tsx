'use client'

import { cloneElement, useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Popover } from 'radix-ui'
import { motion, useReducedMotion } from 'framer-motion'
import 'react-activity-calendar/tooltips.css'
import { ActivityCalendar } from 'react-activity-calendar'
import type { Activity } from 'react-activity-calendar'
import { PROFILE_CONTRIBUTIONS } from '~/constants/user'
import type { ProfileContributionDay } from '~/types/api/user'

import styles from './ContributionCalendar.module.css'

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
const calendarDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
})

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
  next?.focus()
}

type DayOverlay = {
  anchor: SVGRectElement
  activity: Activity
  open: boolean
  switching?: boolean
  mode: 'hover' | 'focus' | 'summary'
}

export function ContributionCalendar({
  days,
  year
}: {
  days: ProfileContributionDay[]
  year?: number
}) {
  const [overlay, setOverlay] = useState<DayOverlay | null>(null)
  const [tabDate, setTabDate] = useState(days[0].date)
  const overlayId = useId()
  const reduceMotion = useReducedMotion()
  const expanded = overlay?.mode === 'summary'
  const counts = expanded
    ? days.find((day) => day.date === overlay.activity.date)?.byType
    : undefined

  const toggleSummary = (anchor: SVGRectElement, activity: Activity) => {
    setOverlay((current) =>
      current?.open && current.anchor === anchor && current.mode === 'summary'
        ? { ...current, open: false }
        : {
            anchor,
            activity,
            open: true,
            mode: 'summary',
            switching: current?.open
          }
    )
  }

  return (
    <div className="relative mx-auto w-fit max-w-full" onKeyDown={navigateDays}>
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
        renderBlock={(block, activity) => {
          const active =
            overlay?.open && overlay.activity.date === activity.date
          return cloneElement(block, {
            // Inset the stroke so the first column and bottom row fit in the SVG.
            x: Number(block.props.x) + 0.5,
            y: Number(block.props.y) + 0.5,
            width: Number(block.props.width) - 1,
            height: Number(block.props.height) - 1,
            tabIndex: activity.date === tabDate ? 0 : -1,
            role: 'button',
            'aria-label': `${activity.date}, ${contributionText(activity)}`,
            'aria-expanded': active && expanded,
            'aria-controls': active && expanded ? overlayId : undefined,
            'aria-describedby': active ? overlayId : undefined,
            onPointerMove: (event) => {
              if (event.pointerType === 'touch') return
              const anchor = event.currentTarget
              setOverlay((current) =>
                current?.open &&
                (current.mode === 'summary' || current.anchor === anchor)
                  ? current
                  : { anchor, activity, open: true, mode: 'hover' }
              )
            },
            onPointerLeave: () =>
              setOverlay((current) =>
                current?.open &&
                current.mode === 'hover' &&
                current.activity.date === activity.date
                  ? { ...current, open: false }
                  : current
              ),
            onFocus: (event) => {
              setTabDate(activity.date)
              const anchor = event.currentTarget
              if (anchor.matches(':focus-visible'))
                setOverlay({ anchor, activity, open: true, mode: 'focus' })
            },
            onClick: (event) => toggleSummary(event.currentTarget, activity),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              if (!event.repeat) toggleSummary(event.currentTarget, activity)
            },
            className:
              'cursor-pointer focus:stroke-primary-900! focus:stroke-1 focus:outline-none'
          })
        }}
      />
      {overlay && (
        <Popover.Root
          open={overlay.open}
          onOpenChange={(open) => {
            if (!open)
              setOverlay((current) => current && { ...current, open: false })
          }}
        >
          <Popover.Anchor virtualRef={{ current: overlay.anchor }} />
          <Popover.Portal>
            <Popover.Content
              id={overlayId}
              data-switching={(overlay.open && overlay.switching) || undefined}
              role={expanded ? 'region' : 'tooltip'}
              aria-label={expanded ? '当日贡献' : undefined}
              side="top"
              sideOffset={6}
              collisionPadding={8}
              hideWhenDetached
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                // The calendar handles switching and toggling its own day buttons.
                if (
                  event.target instanceof SVGRectElement &&
                  overlay.anchor.ownerSVGElement ===
                    event.target.ownerSVGElement
                )
                  event.preventDefault()
              }}
              className={`${styles.overlay} z-50 max-w-[calc(100vw-1rem)] ${expanded ? '' : 'pointer-events-none'}`}
            >
              <motion.div
                layout="size"
                layoutDependency={expanded ? overlay.activity.date : 'preview'}
                transition={{
                  layout: { duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }
                }}
                className={`react-activity-calendar__tooltip shadow-medium ${styles.bubble}`}
                data-expanded={expanded}
              >
                {expanded ? (
                  <div key={overlay.activity.date} className={styles.summary}>
                    <p className="font-medium">
                      {calendarDate.format(new Date(overlay.activity.date))} ·{' '}
                      {overlay.activity.count
                        ? `共 ${overlay.activity.count} 次贡献`
                        : '当天暂无贡献'}
                    </p>
                    {counts && (
                      <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/80">
                        {PROFILE_CONTRIBUTIONS.map(({ key, label }) =>
                          counts[key] ? (
                            <div className="mt-1 flex gap-1" key={key}>
                              <dt>{label}</dt>
                              <dd>{counts[key]}</dd>
                            </div>
                          ) : null
                        )}
                      </dl>
                    )}
                  </div>
                ) : overlay.mode === 'focus' ? (
                  `${overlay.activity.date}, ${contributionText(overlay.activity)}`
                ) : (
                  contributionText(overlay.activity)
                )}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  )
}
