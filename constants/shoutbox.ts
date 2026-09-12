export const SHOUTBOX_PRICE = 50
export const SHOUTBOX_PAGE_SIZE = 6
export const SHOUTBOX_MAX_PAGES = 10
export const SHOUTBOX_MAX_VISIBLE_SLOTS =
  SHOUTBOX_PAGE_SIZE * SHOUTBOX_MAX_PAGES
export const SHOUTBOX_RETENTION_MONTHS = 3
export const SHOUTBOX_EDIT_WINDOW_MS = 5 * 60 * 1000
export const SHOUTBOX_OFFICIAL_DEFAULT_DURATION_MS = 72 * 60 * 60 * 1000

// The per-game association strip title, approved as part of D3. Single source
// for the patch page strip and its tests.
export const SHOUTBOX_PATCH_STRIP_TITLE = '关于本作的小喇叭'

// The station has not supplied a production word list yet. Keep this empty;
// tests and future maintenance code can inject a short-lived list into the
// publish/edit service without introducing a configuration table.
export const SHOUTBOX_BLOCKED_KEYWORDS = [] as const
export const SHOUTBOX_AUTO_HIDE_REPORTER_THRESHOLD = 3
export const SHOUTBOX_KEYWORD_REJECT_MESSAGE = '正文包含不允许的关键词'

export const SHOUTBOX_LEVELS = ['normal', 'important'] as const
export type ShoutboxLevel = (typeof SHOUTBOX_LEVELS)[number]

export const SHOUTBOX_STATUSES = [0, 1, 2, 3] as const
export type ShoutboxStatus = (typeof SHOUTBOX_STATUSES)[number]

export const containsShoutboxKeyword = (
  content: string,
  keywords: readonly string[] = SHOUTBOX_BLOCKED_KEYWORDS
) => {
  const normalized = content.toLocaleLowerCase()
  return keywords.some((keyword) => {
    const candidate = keyword.trim().toLocaleLowerCase()
    return candidate.length > 0 && normalized.includes(candidate)
  })
}

export const SHOUTBOX_STATUS_LABELS: Record<ShoutboxStatus, string> = {
  0: '公开',
  1: '作者已删除',
  2: '隐藏待复核',
  3: '已终止'
}

export const getShoutboxStatusLabel = (status: number, official: boolean) => {
  if (official && status === 3) return '已撤回'
  if (!official && status === 3) return '违规删除'
  return SHOUTBOX_STATUS_LABELS[status as ShoutboxStatus] ?? '未知状态'
}
