export const KUN_FAST_SCROLL_TO_TOP_DURATION_MS = 180

interface ScrollToTopOptions {
  durationMs?: number
}

let activeAnimationFrame: number | undefined

const prefersReducedMotion = () => {
  if (typeof window.matchMedia !== 'function') {
    return false
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const cancelActiveAnimation = () => {
  if (
    activeAnimationFrame !== undefined &&
    typeof window.cancelAnimationFrame === 'function'
  ) {
    window.cancelAnimationFrame(activeAnimationFrame)
  }
  activeAnimationFrame = undefined
}

const getScrollY = () =>
  window.scrollY ||
  window.pageYOffset ||
  document.documentElement.scrollTop ||
  document.body.scrollTop ||
  0

export const kunScrollToTop = ({
  durationMs = KUN_FAST_SCROLL_TO_TOP_DURATION_MS
}: ScrollToTopOptions = {}) => {
  if (typeof window === 'undefined') {
    return
  }

  cancelActiveAnimation()

  if (
    durationMs <= 0 ||
    prefersReducedMotion() ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    window.scrollTo({ top: 0, behavior: 'auto' })
    return
  }

  const startTop = getScrollY()
  const startLeft = window.scrollX || window.pageXOffset || 0

  if (startTop <= 0) {
    window.scrollTo({ top: 0, left: startLeft, behavior: 'auto' })
    return
  }

  let startTime: number | undefined

  const animate = (now: number) => {
    startTime ??= now
    const progress = Math.min((now - startTime) / durationMs, 1)
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    const nextTop =
      progress >= 1
        ? 0
        : Math.max(0, Math.round(startTop * (1 - easedProgress)))

    window.scrollTo({
      top: nextTop,
      left: startLeft,
      behavior: 'auto'
    })

    if (progress < 1) {
      activeAnimationFrame = window.requestAnimationFrame(animate)
    } else {
      activeAnimationFrame = undefined
    }
  }

  activeAnimationFrame = window.requestAnimationFrame(animate)
}
