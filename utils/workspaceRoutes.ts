import { CASE_TABS } from '~/constants/case'

const positiveId = (value: string) =>
  /^[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) <= 2147483647

export const workspaceResourceHref = (id: number, linkId?: number) =>
  `/workspace/resources/${id}${linkId === undefined ? '' : `?linkId=${linkId}`}`

export const workspaceIssueHref = (id: number) => `/workspace/issues/${id}`

/** Notification parsing is deliberately exact: no queries, fragments or suffixes. */
export const parseWorkspaceIssueNotification = (
  href: string
): number | null => {
  const match = /^\/(?:issue|workspace\/issues)\/([1-9]\d*)$/.exec(href)
  return match && positiveId(match[1]) ? Number(match[1]) : null
}

export type WorkspaceSearchParams = Record<
  string,
  string | string[] | undefined
>

/** Duplicate/unknown/invalid query values never survive a compatibility redirect. */
export const workspaceIssueRedirect = (
  params: WorkspaceSearchParams,
  caseId?: number
) => {
  const query = new URLSearchParams()
  for (const key of ['tab', 'status', 'page', 'id'] as const) {
    const value = params[key]
    if (typeof value !== 'string') continue
    const valid =
      key === 'tab'
        ? (CASE_TABS as readonly string[]).includes(value)
        : key === 'status'
          ? ['all', 'processing', 'waiting_reporter', 'closed'].includes(value)
          : positiveId(value)
    if (valid) query.set(key, value)
  }
  const base =
    caseId === undefined ? '/workspace/issues' : workspaceIssueHref(caseId)
  const suffix = query.toString()
  return suffix ? `${base}?${suffix}` : base
}
