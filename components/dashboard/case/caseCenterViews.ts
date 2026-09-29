import {
  CircleCheck,
  CircleSlash,
  Clock3,
  Inbox,
  LayoutDashboard,
  Layers,
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
  /** 1 marks a strict subset of the depth-0 entry above it. */
  depth: 0 | 1
  /**
   * Statuses this view lists. The badge sums exactly these keys, so a filter
   * and its count can never drift apart. null marks the overview, which
   * renders no queue and no badge of its own.
   */
  countKeys: readonly CaseStatus[] | null
  params: CaseListParams
  emptyText: string
}

export type CaseViewGroup =
  | 'overview'
  | 'unresolved'
  | 'closed'
  | 'all'
  | 'oversight'

export const CASE_VIEW_GROUP_LABELS: Record<CaseViewGroup, string> = {
  overview: '概览',
  unresolved: '未结',
  closed: '已结案',
  all: '全部',
  oversight: '只读'
}

/**
 * Who handles each group's cases, in the detail's 处理方 wording. Only the
 * read-only group lists cases still owned by their publisher.
 */
export const CASE_VIEW_GROUP_OWNERS: Record<CaseViewGroup, string> = {
  overview: '站方处理',
  unresolved: '站方处理',
  closed: '站方处理',
  all: '站方处理',
  oversight: '发布者处理'
}

const byStatuses = (keys: readonly CaseStatus[]): CaseListParams => ({
  statuses: keys.join(',')
})

/**
 * Secondary navigation of the case center. Every entry maps to a filter the
 * admin list endpoint actually supports, so none of them is a dead link.
 *
 * Two entries deliberately do not spell their statuses into the request:
 *
 * - 未结事项 sends no status parameter at all. The server's default window is
 *   the same set, and it is also the definition of the staff inbox queue
 *   (module 03 §3.5), so restating it client-side would risk the two drifting.
 * - 全部事项 sends `allStatuses=true` rather than an enumeration. Module 06
 *   will start writing `merged`; an enumerated "everything" view would stop
 *   covering it silently. `countKeys` still lists every status because the
 *   badge has to sum the response's keys.
 *
 * Deliberately absent, per module 03 §4「不做」and §2: assignee queues, SLA
 * or overdue buckets, knowledge base, reports and automation rules. `merged`
 * gets no entry of its own — this module never writes it — but 全部事项
 * includes it, which is exactly why that view uses `allStatuses`.
 */
export const CASE_CENTER_VIEWS: CaseCenterView[] = [
  {
    value: 'overview',
    label: '工作台',
    icon: LayoutDashboard,
    group: 'overview',
    depth: 0,
    countKeys: null,
    params: {},
    emptyText: ''
  },
  {
    value: 'unresolved',
    label: '未结事项',
    icon: Inbox,
    group: 'unresolved',
    depth: 0,
    countKeys: CASE_UNRESOLVED_STATUSES,
    params: {},
    emptyText: '站方队列当前没有未结事项'
  },
  {
    // `open` alone would silently drop the cases a reporter has just answered:
    // the status machine moves a staff-owned case to `waiting_owner` then, and
    // those are the ones most in need of a look.
    value: 'pending',
    label: '待处理',
    icon: UserRoundCheck,
    group: 'unresolved',
    depth: 1,
    countKeys: ['open', 'waiting_owner'],
    params: byStatuses(['open', 'waiting_owner']),
    emptyText: '没有等待站方处理的事项'
  },
  {
    value: 'waiting_reporter',
    label: '等待报告者',
    icon: Clock3,
    group: 'unresolved',
    depth: 1,
    countKeys: ['waiting_reporter'],
    params: byStatuses(['waiting_reporter']),
    emptyText: '没有等待报告者补充的事项'
  },
  {
    value: 'resolved',
    label: '已解决',
    icon: CircleCheck,
    group: 'closed',
    depth: 0,
    countKeys: ['resolved'],
    params: byStatuses(['resolved']),
    emptyText: '暂无已解决的事项'
  },
  {
    value: 'rejected',
    label: '已驳回',
    icon: CircleSlash,
    group: 'closed',
    depth: 0,
    countKeys: ['rejected'],
    params: byStatuses(['rejected']),
    emptyText: '暂无已驳回的事项'
  },
  {
    value: 'all',
    label: '全部事项',
    icon: Layers,
    group: 'all',
    depth: 0,
    countKeys: CASE_STATUSES,
    params: { allStatuses: 'true' },
    emptyText: '还没有任何事项'
  },
  {
    // D22: publisher-owned cases the staff may step into before the 7-day
    // handoff. Read-only oversight: outside the inbox and the pending counts.
    value: 'publisher',
    label: '发布者处理中',
    icon: UsersRound,
    group: 'oversight',
    depth: 0,
    countKeys: CASE_UNRESOLVED_STATUSES,
    params: { ownerType: 'publisher' },
    emptyText: '没有仍由发布者处理的事项'
  }
]

/**
 * Says out loud that the six queue numbers are not mutually exclusive, and
 * which cases the 站方处理 groups hold.
 */
export const CASE_VIEW_OVERLAP_HINT =
  '待处理与等待报告者是未结事项的两个子集；全部事项另含已结案。站方处理：违规举报、条目资料有误、资源发错条目、站务反馈与条目页「其他」、官方资源的问题，以及发布者 7 天未处理或报告者申请复核后转来的资源问题。发布者处理中不在站方队列里。'

export const DEFAULT_CASE_VIEW = CASE_CENTER_VIEWS[0]
/** Staff queue: what the overview reports on and where a deep link lands. */
export const UNRESOLVED_CASE_VIEW = CASE_CENTER_VIEWS[1]
/** Strict subset of the staff queue: the cases whose turn it is. */
export const PENDING_CASE_VIEW = CASE_CENTER_VIEWS[2]

export const findCaseView = (raw: string | null): CaseCenterView =>
  CASE_CENTER_VIEWS.find((view) => view.value === raw) ?? DEFAULT_CASE_VIEW

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
