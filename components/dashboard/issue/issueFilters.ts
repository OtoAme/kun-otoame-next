import type { CaseStatus, CaseStatusCounts, CaseTab } from '~/types/api/case'

export type StatusFilterKey =
  | 'all'
  | 'processing'
  | 'waiting_reporter'
  | 'closed'

/**
 * 用户侧状态分组。列表接口只按原始状态筛选，而 `open` 与 `waiting_owner` 在
 * `CASE_STATUS_LABELS` 里本就是同一个词「等待处理方」，所以分组靠 `statuses`
 * 逗号参数一次筛出。`resolved` 与 `rejected` 同样合并成「已结案」：用户侧要在
 * 390px 窄屏一行放下（拆开约 413px，容器只有约 334px，会被迫横向滚动），而
 * `rejected` 并没有因此被藏起来——它在「已结案」里，每行徽标仍分别显示
 * 「已解决」/「已驳回」。后台侧刻意不同：那边按结论复盘、竖列导航没有宽度
 * 压力，保留「已解决」「已驳回」两个独立入口。两侧口径不一致是有意为之。
 * `merged` 保留给模块 06、本模块永不写入，不单独成页签，但仍计入「全部」——
 * 「全部」就是不带状态参数的那一次请求。
 */
export const STATUS_FILTERS: {
  key: StatusFilterKey
  statuses: CaseStatus[]
}[] = [
  { key: 'all', statuses: [] },
  { key: 'processing', statuses: ['open', 'waiting_owner'] },
  { key: 'waiting_reporter', statuses: ['waiting_reporter'] },
  { key: 'closed', statuses: ['resolved', 'rejected'] }
]

const STATUS_FILTER_KEYS: ReadonlySet<string> = new Set(
  STATUS_FILTERS.map((filter) => filter.key)
)

export const parseStatusFilter = (raw: string | null): StatusFilterKey =>
  raw !== null && STATUS_FILTER_KEYS.has(raw) ? (raw as StatusFilterKey) : 'all'

export const statusFilterStatuses = (key: StatusFilterKey): CaseStatus[] =>
  STATUS_FILTERS.find((filter) => filter.key === key)?.statuses ?? []

/**
 * 分组文案随所在分页换人称，口径与列表行徽标的 `caseViewerStatusText` 完全一致：
 * 「待我处理」分页里球在处理方那边就是等我处理，「我提交的」分页里等待报告者
 * 就是等我补充。不新造与 `CASE_STATUS_LABELS` 冲突的词。
 */
export const statusFilterLabel = (
  key: StatusFilterKey,
  tab: CaseTab
): string => {
  switch (key) {
    case 'all':
      return '全部'
    case 'processing':
      return tab === 'owned' ? '等待我处理' : '等待处理方'
    case 'waiting_reporter':
      return tab === 'reported' ? '等待我补充' : '等待报告者'
    case 'closed':
      return '已结案'
  }
}

/** 计数作用域尊重 tab、忽略状态筛选，所以每一组都能从同一份计数里相加得到。 */
export const statusFilterCount = (
  key: StatusFilterKey,
  counts: CaseStatusCounts
): number => {
  const statuses = statusFilterStatuses(key)
  const keys =
    statuses.length > 0 ? statuses : (Object.keys(counts) as CaseStatus[])
  return keys.reduce((sum, status) => sum + counts[status], 0)
}
