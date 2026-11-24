const isNotificationVisible = (element: HTMLElement, wholeBody: boolean) => {
  if (
    document.visibilityState !== 'visible' ||
    (wholeBody && !document.hasFocus()) ||
    !element.isConnected
  )
    return false
  const rect = element.getBoundingClientRect()
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const visibleTop = Math.max(rect.top, top)
  const visibleBottom = Math.min(rect.bottom, top + height)
  const visibleLeft = Math.max(rect.left, left)
  const visibleRight = Math.min(rect.right, left + width)
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    visibleRight <= visibleLeft ||
    visibleBottom <= visibleTop ||
    (wholeBody &&
      (rect.left < left ||
        rect.right > left + width ||
        (visibleBottom - visibleTop) / Math.min(rect.height, height) < 0.8))
  )
    return false
  for (
    let ancestor: HTMLElement | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor)
    if (
      style.visibility !== 'visible' ||
      style.display === 'none' ||
      style.contentVisibility === 'hidden' ||
      style.opacity === '0'
    )
      return false
  }
  for (const horizontal of [0.15, 0.5, 0.85]) {
    for (const vertical of [0.15, 0.5, 0.85]) {
      const hit = document.elementFromPoint(
        visibleLeft + (visibleRight - visibleLeft) * horizontal,
        visibleTop + (visibleBottom - visibleTop) * vertical
      )
      const uncovered = hit && element.contains(hit)
      if (wholeBody && !uncovered) return false
      if (!wholeBody && uncovered) return true
    }
  }
  return wholeBody
}

export const isNotificationBodyVisible = (element: HTMLElement) =>
  isNotificationVisible(element, true)

export const isNotificationCardVisible = (element: HTMLElement) =>
  isNotificationVisible(element, false)

export const observeNotificationReading = (
  element: HTMLElement,
  onRead: () => void,
  duration = 1000,
  mode: 'body' | 'card' = 'body'
) => {
  const visible =
    mode === 'card' ? isNotificationCardVisible : isNotificationBodyVisible
  let since: number | null = null
  let stopped = false
  const reset = () => {
    since = null
  }
  const tick = () => {
    if (stopped) return
    if (!visible(element)) {
      reset()
      return
    }
    const now = performance.now()
    if (since === null) since = now
    if (now - since >= duration) {
      stopped = true
      window.clearInterval(interval)
      onRead()
    }
  }
  const interval = window.setInterval(tick, 100)
  const handleViewportChange = mode === 'card' ? tick : reset
  const events = ['blur', 'focus', 'resize', 'scroll'] as const
  events.forEach((event) =>
    window.addEventListener(event, handleViewportChange, true)
  )
  document.addEventListener('visibilitychange', handleViewportChange)
  tick()
  return () => {
    stopped = true
    window.clearInterval(interval)
    events.forEach((event) =>
      window.removeEventListener(event, handleViewportChange, true)
    )
    document.removeEventListener('visibilitychange', handleViewportChange)
  }
}
