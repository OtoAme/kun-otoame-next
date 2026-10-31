import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ areas: [] as Record<string, unknown>[] }))
// Record what the chart is asked to draw; jsdom cannot lay out SVG charts.
vi.mock('recharts', async () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    ResponsiveContainer: Pass,
    AreaChart: Pass,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Area: (props: Record<string, unknown>) => {
      mocks.areas.push(props)
      return null
    }
  }
})

import { DashboardTrend } from '~/components/dashboard/DashboardTrend'
import type { StatsTrendData } from '~/types/api/admin'

const data: StatsTrendData = {
  days: 2,
  recentLogin: 1,
  points: ['2026-10-30', '2026-10-31'].map((date, index) => ({
    date,
    newUser: index + 1,
    newGalgame: 0,
    newGalgameResource: 0,
    newComment: 0,
    newRating: 0,
    newSubmission: 0,
    newCase: 0,
    resourceAccess: 0,
    checkIn: 3
  }))
}

describe('dashboard trend chart animation', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement
  let reduced = false
  const listeners = new Set<() => void>()

  beforeEach(() => {
    mocks.areas.length = 0
    reduced = false
    listeners.clear()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard'
    })
    dom.window.matchMedia = ((query: string) => ({
      get matches() {
        return query.includes('reduce') && reduced
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn)
    })) as unknown as typeof dom.window.matchMedia
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const lastArea = () => mocks.areas.at(-1)!
  const stops = () => [...container.querySelectorAll('stop')]

  it('animates the area and fades the fill between metrics', async () => {
    await act(async () => root.render(<DashboardTrend data={data} />))
    expect(lastArea()).toMatchObject({
      dataKey: 'newUser',
      isAnimationActive: true,
      animationDuration: 450,
      animationEasing: 'cubic-bezier(0.22, 1, 0.36, 1)'
    })
    expect(stops().map((stop) => stop.style.transition)).toEqual([
      'stop-color 450ms cubic-bezier(0.22, 1, 0.36, 1)',
      'stop-color 450ms cubic-bezier(0.22, 1, 0.36, 1)'
    ])

    // Switching keeps one Area and one gradient, so Recharts morphs the
    // line and the stops fade instead of a new gradient replacing the old.
    const gradientBefore = container.querySelector('linearGradient')!.id
    const tab = [...container.querySelectorAll('[role=tab]')].find((el) =>
      el.textContent?.includes('签到')
    ) as HTMLButtonElement
    await act(async () => tab.click())
    expect(lastArea().dataKey).toBe('checkIn')
    expect(container.querySelector('linearGradient')!.id).toBe(gradientBefore)
    expect(lastArea().fill).toBe(`url(#${gradientBefore})`)
  })

  it('draws without motion when the system asks to reduce it', async () => {
    reduced = true
    await act(async () => root.render(<DashboardTrend data={data} />))
    expect(lastArea().isAnimationActive).toBe(false)
    expect(stops().every((stop) => stop.style.transition === '')).toBe(true)
  })

  it('follows a reduced-motion change made while the page is open', async () => {
    await act(async () => root.render(<DashboardTrend data={data} />))
    expect(lastArea().isAnimationActive).toBe(true)
    reduced = true
    await act(async () => listeners.forEach((fn) => fn()))
    expect(lastArea().isAnimationActive).toBe(false)
  })
})
