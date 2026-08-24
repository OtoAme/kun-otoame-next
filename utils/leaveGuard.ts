interface NavigationAnchor {
  href: string
  target: string | null
  hasDownload: boolean
}

// Returns the in-app destination a click would navigate to, or null when the
// click cannot lose unsaved work: downloads, new tabs, other origins, in-page
// anchors, and re-navigating to the route the user is already on.
export const getInternalNavigationHref = (
  anchor: NavigationAnchor,
  currentUrl: string
): string | null => {
  if (anchor.hasDownload) {
    return null
  }
  if (anchor.target && anchor.target !== '_self') {
    return null
  }

  let target: URL
  let current: URL
  try {
    current = new URL(currentUrl)
    target = new URL(anchor.href, currentUrl)
  } catch {
    return null
  }

  if (target.origin !== current.origin) {
    return null
  }
  if (target.pathname === current.pathname && target.search === current.search) {
    return null
  }

  return `${target.pathname}${target.search}${target.hash}`
}
