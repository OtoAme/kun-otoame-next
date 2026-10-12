'use client'

import { LinkHealthAdminView } from './LinkHealthAdminView'
import { useAdminLinkHealth } from './useAdminLinkHealth'

export function LinkHealthAdminClient() {
  const view = useAdminLinkHealth()
  return <LinkHealthAdminView view={view} />
}
