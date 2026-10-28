import { useCallback, useState } from 'react'

/**
 * Tracks an element's content width. Layouts switch on the main content
 * width rather than the viewport, so opening or collapsing the sidebar moves
 * a page between layouts the same way resizing the window does. Width is 0
 * until the element is measured, which renders the narrow layout first.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0)
  const ref = useCallback((node: T | null) => {
    if (!node) return
    setWidth(node.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
