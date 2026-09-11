import type { InboxKind } from '~/types/api/inbox'

export const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  submission: '待审投稿',
  'resource-apply': '待审资源',
  feedback: '旧反馈',
  report: '旧举报'
}

export const DASHBOARD_LEGACY_LINKS = [
  { href: '/admin', label: '统计', minRole: 4 },
  { href: '/admin/submission', label: '投稿历史', minRole: 3 },
  { href: '/admin/resource-apply', label: '资源申请', minRole: 4 },
  { href: '/admin/feedback', label: '反馈处理', minRole: 4 },
  { href: '/admin/report', label: '评论举报', minRole: 4 },
  { href: '/admin/rating-report', label: '评价举报', minRole: 4 },
  { href: '/admin/resource', label: '资源管理', minRole: 4 },
  { href: '/admin/creator', label: '创作者申请', minRole: 4 },
  { href: '/admin/otomegame', label: '条目管理', minRole: 4 },
  { href: '/admin/comment', label: '评论管理', minRole: 4 },
  { href: '/admin/rating', label: '评价管理', minRole: 3 },
  { href: '/admin/stickers', label: '贴纸管理', minRole: 3 },
  { href: '/admin/log', label: '管理日志', minRole: 4 },
  { href: '/admin/user', label: '用户管理', minRole: 4 },
  { href: '/admin/setting', label: '站点设置', minRole: 4 },
  { href: '/admin/email', label: '群发邮件', minRole: 4 }
] as const
