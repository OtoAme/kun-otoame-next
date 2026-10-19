export const WORKSPACE_CONTRACT_VERSION = 1 as const
export const WORKSPACE_ENTRY_VIEWS = ['submissions', 'published'] as const
export const WORKSPACE_MAINTENANCE_VIEWS = [
  'feedback',
  'optional',
  'handled'
] as const
export const WORKSPACE_RESOURCE_STATUSES = [
  'all',
  'normal',
  'pending',
  'banned'
] as const
export const WORKSPACE_SECTIONS = ['all', 'galgame', 'patch'] as const
export const WORKSPACE_PAGE_LIMIT = 20
export const WORKSPACE_MAX_PAGE_LIMIT = 50
export const WORKSPACE_CACHE_CONTROL = 'private, no-store'

export const PUBLISHED_ENTRY_CORRECTION_NOTICE =
  '已发布条目的修改申请暂未开放，后续将逐步支持。如需更正信息，可以通过条目反馈说明。'

export const WORKSPACE_ERRORS = {
  invalid_request: { status: 400, message: '工作台请求格式不正确' },
  login_required: { status: 401, message: '请先登录后再操作' },
  forbidden: { status: 403, message: '您没有权限操作该资源' },
  resource_readonly: { status: 403, message: '待审核或封禁的资源暂不支持编辑' },
  not_found: { status: 404, message: '资源不存在或不可访问' },
  conflict: { status: 409, message: '该资源已被他人修改，请刷新后重试' },
  unavailable: { status: 503, message: '暂时无法完成操作，请稍后重试' }
} as const
