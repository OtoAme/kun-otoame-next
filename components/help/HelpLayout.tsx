'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

const STICKY_TOP = 80
const LG_QUERY = '(min-width: 1024px)'

type Pin = 'top' | 'fixed' | 'bottom'

/**
 * Two-column forum layout from the lg breakpoint; below it the sidebar
 * follows the main column so the list stays first on phones.
 *
 * The site layout keeps `overflow-y: auto` on body (RootRouteChrome restores
 * page scrolling that way after private chat), which disables CSS
 * `position: sticky` site-wide. The sidebar therefore switches between three
 * static positions, in flow, `position: fixed` at the sticky top, and pinned
 * to the column end, so it behaves like sticky without moving on every
 * scroll frame.
 */
export const HelpLayout = ({
  sidebar,
  children
}: {
  sidebar: ReactNode
  children: ReactNode
}) => {
  const columnRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState<Pin>('top')
  const [box, setBox] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const media = window.matchMedia(LG_QUERY)
    let frame = 0
    const update = () => {
      frame = 0
      const column = columnRef.current
      const panel = sidebarRef.current
      if (!column || !panel || !media.matches) {
        setPin('top')
        return
      }
      const rect = column.getBoundingClientRect()
      const height = panel.offsetHeight
      setBox({ left: rect.left, width: rect.width })
      // A sidebar taller than the window would lose its bottom while pinned,
      // so it then scrolls with the page instead.
      const fits = height <= window.innerHeight - STICKY_TOP - 16
      if (!fits || rect.top >= STICKY_TOP || column.offsetHeight <= height) {
        setPin('top')
      } else if (rect.bottom - height <= STICKY_TOP) {
        setPin('bottom')
      } else {
        setPin('fixed')
      }
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    media.addEventListener('change', schedule)
    const observer = new ResizeObserver(schedule)
    if (columnRef.current) observer.observe(columnRef.current)
    if (sidebarRef.current) observer.observe(sidebarRef.current)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      media.removeEventListener('change', schedule)
      observer.disconnect()
    }
  }, [])

  const style: CSSProperties | undefined =
    pin === 'fixed'
      ? { position: 'fixed', top: STICKY_TOP, left: box.left, width: box.width }
      : pin === 'bottom'
        ? { position: 'absolute', bottom: 0, left: 0, right: 0 }
        : undefined

  return (
    <div className="container mx-auto my-4 grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-6">{children}</div>
      <div ref={columnRef} className="relative">
        <div ref={sidebarRef} style={style}>
          {sidebar}
        </div>
      </div>
    </div>
  )
}
