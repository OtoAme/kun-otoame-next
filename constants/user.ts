export const PROFILE_ENTRY_PAGE_SIZE = 21

export const PROFILE_CONTRIBUTIONS = [
  { key: 'patch_resource', label: '发布资源' },
  { key: 'patch', label: '发布条目' },
  { key: 'patch_comment', label: '评论' },
  { key: 'patch_rating', label: '评价' }
] as const

export const USER_ROLE_MAP: Record<number, string> = {
  1: '用户',
  2: '创作者',
  3: '管理员',
  4: '超级管理员'
}

export const ADMIN_ROLE = 3

export const canAccessAdmin = (role: number) => role >= ADMIN_ROLE

export const USER_STATUS_MAP: Record<number, string> = {
  0: '正常',
  1: '限制（正在开发中）',
  2: '封禁'
}

export const USER_STATUS_COLOR_MAP: Record<
  number,
  'success' | 'warning' | 'danger'
> = {
  0: 'success',
  1: 'warning',
  2: 'danger'
}
