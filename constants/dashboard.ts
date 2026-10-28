import type { InboxKind, LinkHealthInboxKind } from '~/types/api/inbox'

export const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  submission: '待审条目',
  'resource-apply': '待审资源',
  feedback: '旧反馈',
  report: '旧举报',
  case: '事项',
  'broken-link': '失效链接待办'
}

/** W04-health 合流时随收件箱读写面一起启用的完整标签表。 */
export const LINK_HEALTH_INBOX_KIND_LABELS: Record<
  LinkHealthInboxKind,
  string
> = {
  submission: '待审条目',
  'resource-apply': '待审资源',
  feedback: '旧反馈',
  report: '旧举报',
  case: '事项',
  'broken-link': '失效链接待办'
}

export type DashboardNavMatch = 'exact' | 'prefix'

export interface DashboardNavItem {
  id: string
  label: string
  href: string
  /** Lowest role that may open the page; hidden from everyone below it. */
  minRole: 3 | 4
  /** Legacy admin pages load the other root layout, so they need a full reload. */
  legacy?: boolean
  match?: DashboardNavMatch
}

export interface DashboardNavGroup {
  label: string | null
  items: DashboardNavItem[]
}

/**
 * Sidebar groups by kind of work. Items whose console page is not built yet
 * still point at the legacy admin page with that page's current permission;
 * each migration swaps the href and minRole in place.
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: null,
    items: [
      {
        id: 'overview',
        label: '总览',
        href: '/dashboard',
        minRole: 3,
        match: 'exact'
      }
    ]
  },
  {
    label: '待处理',
    items: [
      { id: 'inbox', label: '待审事项', href: '/dashboard/inbox', minRole: 3 },
      { id: 'case', label: '事项中心', href: '/dashboard/case', minRole: 3 },
      {
        id: 'creator',
        label: '创作者申请',
        href: '/admin/creator',
        minRole: 4,
        legacy: true
      }
    ]
  },
  {
    label: '内容',
    items: [
      {
        id: 'game',
        label: '游戏条目',
        href: '/admin/otomegame',
        minRole: 4,
        legacy: true
      },
      {
        id: 'resource',
        label: '下载资源',
        href: '/admin/resource',
        minRole: 4,
        legacy: true
      },
      {
        id: 'comment',
        label: '评论',
        href: '/dashboard/comment',
        minRole: 3
      },
      {
        id: 'rating',
        label: '评价',
        href: '/admin/rating',
        minRole: 3,
        legacy: true
      },
      {
        id: 'sticker',
        label: '贴纸',
        href: '/admin/stickers',
        minRole: 3,
        legacy: true
      },
      {
        id: 'link-health',
        label: '已失效链接',
        href: '/dashboard/link-health',
        minRole: 3
      },
      {
        id: 'company-merges',
        label: '会社合并',
        href: '/dashboard/company-merges',
        minRole: 3
      },
      {
        id: 'submission',
        label: '投稿历史',
        href: '/admin/submission',
        minRole: 3,
        legacy: true
      },
      {
        id: 'archive-feedback',
        label: '旧反馈',
        href: '/admin/feedback',
        minRole: 4,
        legacy: true
      },
      {
        id: 'archive-report',
        label: '旧评论举报',
        href: '/admin/report',
        minRole: 4,
        legacy: true
      },
      {
        id: 'archive-rating-report',
        label: '旧评价举报',
        href: '/admin/rating-report',
        minRole: 4,
        legacy: true
      }
    ]
  },
  {
    label: '社区',
    items: [
      {
        id: 'shoutbox',
        label: '小喇叭',
        href: '/dashboard/shoutbox',
        minRole: 3
      },
      { id: 'user', label: '用户管理', href: '/dashboard/user', minRole: 4 }
    ]
  },
  {
    label: '站点',
    items: [
      {
        id: 'log',
        label: '管理日志',
        href: '/admin/log',
        minRole: 4,
        legacy: true
      },
      {
        id: 'setting',
        label: '站点设置',
        href: '/admin/setting',
        minRole: 4,
        legacy: true
      },
      {
        id: 'email',
        label: '邮件群发',
        href: '/admin/email',
        minRole: 4,
        legacy: true
      }
    ]
  }
]

export const getVisibleDashboardNav = (role: number): DashboardNavGroup[] =>
  DASHBOARD_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => role >= item.minRole)
  })).filter((group) => group.items.length > 0)

export const isDashboardNavActive = (
  item: DashboardNavItem,
  pathname: string
) =>
  item.match === 'exact'
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`)
