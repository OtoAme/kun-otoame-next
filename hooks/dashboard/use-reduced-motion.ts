import * as React from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the viewer asked the system to reduce motion. Follows changes made
 * while the page is open. Starts false on the server and before mount, so
 * the first client paint matches the server markup.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia?.(QUERY)
    if (!mql) return
    const onChange = () => setReduced(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
