export const isNotificationBodyVisible = (element: HTMLElement) => {
  if (
    document.visibilityState !== 'visible' ||
    !document.hasFocus() ||
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
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.left < left ||
    rect.right > left + width ||
    (visibleBottom - visibleTop) / Math.min(rect.height, height) < 0.8
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
        rect.left + rect.width * horizontal,
        visibleTop + (visibleBottom - visibleTop) * vertical
      )
      if (!hit || !element.contains(hit)) return false
    }
  }
  return true
}

export const observeNotificationReading = (
  element: HTMLElement,
  onRead: () => void,
  duration = 1000
) => {
  let since: number | null = null
  let stopped = false
  const reset = () => {
    since = null
  }
  const tick = () => {
    if (stopped) return
    if (!isNotificationBodyVisible(element)) {
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
  const events = ['blur', 'focus', 'resize', 'scroll'] as const
  events.forEach((event) => window.addEventListener(event, reset, true))
  document.addEventListener('visibilitychange', reset)
  tick()
  return () => {
    stopped = true
    window.clearInterval(interval)
    events.forEach((event) => window.removeEventListener(event, reset, true))
    document.removeEventListener('visibilitychange', reset)
  }
}
