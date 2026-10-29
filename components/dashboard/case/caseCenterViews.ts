import {
  CircleCheck,
  Clock3,
  Layers,
  Unlink,
  UserRoundCheck,
  UsersRound,
  type LucideIcon
} from 'lucide-react'

import { CASE_STATUSES, CASE_UNRESOLVED_STATUSES } from '~/constants/case'
import type { CaseStatus, CaseStatusCounts } from '~/types/api/case'

/**
 * Status parameters for `GET /admin/case`. The server resolves them in a
 * most-specific-wins ladder — `statuses` > `status` > `allStatuses` > the
 * default unresolved window — so a view sends at most one of them.
 */
export interface CaseListParams {
  statuses?: string
  /** A query value is a string; the schema takes 'true'/'false', not 1/0. */
  allStatuses?: 'true'
  /** Read-only oversight of publisher-owned cases (D22); absent means staff. */
  ownerType?: 'publisher'
}

export interface CaseCenterView {
  /** `view` search param. */
  value: string
  label: string
  icon: LucideIcon
  group: CaseViewGroup
  /**
   * Statuses this view lists. The badge sums exactly these keys, so a filter
   * and its count can never drift apart. null marks a view that lists no
   * cases (the broken resource-disk links).
   */
  countKeys: readonly CaseStatus[] | null
  params: CaseListParams
  emptyText: string
}

export type CaseViewGroup = 'todo' | 'browse'

export const CASE_VIEW_GROUP_LABELS: Record<CaseViewGroup, string> = {
  todo: '待办',
  browse: '查看'
}

const byStatuses = (keys: readonly CaseStatus[]): CaseListParams => ({
  statuses: keys.join(',')
})

/**
 * Secondary navigation of the issue page. 待办 holds the work waiting on the
 * staff, each entry disjoint from the others; 查看 holds read-only or closed
 * lists. Every case entry maps to a filter the admin list endpoint supports.
 *
 * 全部 sends `allStatuses=true` rather than an enumeration: module 06 will
 * start writing `merged`, and an enumerated "everything" view would stop
 * covering it silently. `countKeys` still lists every status because the
 * badge has to sum the response's keys.
 *
 * Deliberately absent, per module 03 §4「不做」and §2: assignee queues, SLA
 * or overdue buckets, knowledge base, reports and automation rules.
 */
export const CASE_CENTER_VIEWS: CaseCenterView[] = [
  {
    // `open` alone would silently drop the cases a reporter has just answered:
    // the status machine moves a staff-owned case to `waiting_owner` then, and
    // those are the ones most in need of a look.
    value: 'pending',
    label: '待处理',
    icon: UserRoundCheck,
    group: 'todo',
    countKeys: ['open', 'waiting_owner'],
    params: byStatuses(['open', 'waiting_owner']),
    emptyText: '没有等待站方处理的问题'
  },
  {
    value: 'waiting_reporter',
    label: '等待报告者',
    icon: Clock3,
    group: 'todo',
    countKeys: ['waiting_reporter'],
    params: byStatuses(['waiting_reporter']),
    emptyText: '没有等待报告者补充的问题'
  },
  {
    value: 'broken-link',
    label: '资源盘链接失效',
    icon: Unlink,
    group: 'todo',
    countKeys: null,
    params: {},
    emptyText: '没有失效的资源盘链接'
  },
  {
    // D22: publisher-owned cases the staff may step into before the 7-day
    // handoff. Read-only oversight: outside the pending counts.
    value: 'publisher',
    label: '发布者处理中',
    icon: UsersRound,
    group: 'browse',
    countKeys: CASE_UNRESOLVED_STATUSES,
    params: { ownerType: 'publisher' },
    emptyText: '没有仍由发布者处理的问题'
  },
  {
    value: 'closed',
    label: '已结案',
    icon: CircleCheck,
    group: 'browse',
    countKeys: ['resolved', 'rejected'],
    params: byStatuses(['resolved', 'rejected']),
    emptyText: '暂无已结案的问题'
  },
  {
    value: 'all',
    label: '全部',
    icon: Layers,
    group: 'browse',
    countKeys: CASE_STATUSES,
    params: { allStatuses: 'true' },
    emptyText: '还没有任何问题'
  }
]

/** Which cases the staff queue holds, shown under the navigation. */
export const CASE_VIEW_SCOPE_HINT =
  '站方处理：违规举报、条目资料有误、资源发错条目、站务反馈、求资源或催更、官方资源的问题，以及发布者 7 天未处理或报告者申请复核后转来的资源问题。'

export const DEFAULT_CASE_VIEW = CASE_CENTER_VIEWS[0]
export const BROKEN_LINK_CASE_VIEW = CASE_CENTER_VIEWS[2]

// Older links named views that were folded into the ones above.
const VIEW_ALIASES: Record<string, string> = {
  overview: 'pending',
  unresolved: 'pending',
  resolved: 'closed',
  rejected: 'closed'
}

export const findCaseView = (raw: string | null): CaseCenterView => {
  const value = raw !== null ? (VIEW_ALIASES[raw] ?? raw) : null
  return (
    CASE_CENTER_VIEWS.find((view) => view.value === value) ?? DEFAULT_CASE_VIEW
  )
}

/**
 * Badge number for one navigation entry: the sum of the same status keys the
 * entry filters by. `statusCounts` is scoped by kind and search only, never
 * by a status parameter, so one response feeds every entry at once. The
 * counts in hand are the staff queue's, so the publisher view has no badge.
 */
export const caseViewCount = (
  counts: CaseStatusCounts | null,
  view: CaseCenterView
): number | null => {
  if (!counts || view.countKeys === null || view.params.ownerType) return null
  return view.countKeys.reduce((sum, status) => sum + counts[status], 0)
}

/** Views listing publisher-owned cases rather than the staff queue. */
export const isPublisherCaseView = (view: CaseCenterView) =>
  view.params.ownerType === 'publisher'

/** The view listing broken resource-disk links instead of cases. */
export const isBrokenLinkView = (view: CaseCenterView) =>
  view.value === BROKEN_LINK_CASE_VIEW.value
