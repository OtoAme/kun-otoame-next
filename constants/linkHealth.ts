export const LINK_HEALTH_STATES = [
  'ok',
  'suspect',
  'disputed',
  'broken'
] as const
export const LINK_REPORT_REASONS = [
  'deleted',
  'access_condition',
  'unreachable'
] as const
export const LINK_REPORT_WEIGHTS = {
  deleted: 1,
  access_condition: 1,
  unreachable: 0.5
} as const
export const LINK_HEALTH_OWNER_ACTIONS = ['verify', 'confirm_broken'] as const
export const LINK_HEALTH_RESOLVE_ACTIONS = ['available', 'broken'] as const
export const LINK_CHECK_VERDICTS = ['available', 'broken', 'unknown'] as const
// Providers supported by LLC; result tuples are validated by the adapter.
export const LINK_CHECK_PROVIDERS = [
  'baidu',
  'quark',
  'uc',
  'caiyun',
  'pan123'
] as const
export const LINK_CHECK_PROVIDER_LABELS = {
  baidu: '百度网盘',
  quark: '夸克网盘',
  uc: 'UC网盘',
  caiyun: '和彩云',
  pan123: '123云盘'
} as const satisfies Record<(typeof LINK_CHECK_PROVIDERS)[number], string>
export const LINK_CHECK_REASONS = [
  'share_available',
  'share_deleted',
  'share_cancelled',
  'share_expired',
  'share_blocked',
  'access_unverified',
  'unsupported',
  'rate_limited',
  'timeout',
  'unavailable',
  'invalid_response',
  'untrusted_result'
] as const
export const LINK_DISPUTE_SOURCES = [
  'owner_verification',
  'machine_user_conflict'
] as const
export const LINK_CASE_RESOLUTIONS = {
  relinked: '已补链',
  verified_available: '核实可用',
  confirmed_broken: '确认失效',
  timeout_broken: '超时失效',
  auto_broken: '自动判失效',
  staff_broken: '站方判失效',
  staff_available: '站方判可用',
  auto_available: '自动收敛可用',
  machine_broken: '检测确认失效',
  link_removed: '链接已移除'
} as const

export const LINK_HEALTH_POLICY = {
  reportThreshold: 3,
  reportWindowMs: 72 * 60 * 60 * 1000,
  acquisitionWindowMs: 30 * 24 * 60 * 60 * 1000,
  reporterCooldownMs: 7 * 24 * 60 * 60 * 1000,
  verificationIntervalMs: 30 * 24 * 60 * 60 * 1000,
  suspectTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  disputeConvergenceMs: 30 * 24 * 60 * 60 * 1000,
  checkDisplayTtlMs: 60 * 60 * 1000,
  checkBudgetMs: 15 * 1000,
  checkClockSkewMs: 5 * 1000,
  checkCacheMaxAgeMs: 5 * 60 * 1000,
  staffMinRole: 3,
  staffStorage: 'touchgal'
} as const

/** JSON string error bodies preserve the existing kunFetch contract. */
export const LINK_HEALTH_ERRORS = {
  invalid_request: { status: 400, message: '链接请求格式不正确' },
  network_confirmation_required: {
    status: 400,
    message: '请先确认已尝试更换网络或加速器'
  },
  slow_is_not_failure: {
    status: 400,
    message: '下载慢不属于链接失效，请查看下载相关问题解答'
  },
  login_required: { status: 401, message: '请先登录后再操作' },
  forbidden: { status: 403, message: '您没有权限操作该链接' },
  acquisition_required: {
    status: 403,
    message: '报告需要在最近 30 天内获取过该链接的当前版本'
  },
  not_found: { status: 404, message: '链接不存在或不可访问' },
  version_conflict: {
    status: 409,
    message: '该链接已更新，请刷新后重试'
  },
  state_conflict: {
    status: 409,
    message: '该链接的处理状态已变化，请刷新后重试'
  },
  resource_conflict: {
    status: 409,
    message: '该资源已被他人修改，请刷新后重试'
  },
  verification_cooldown: {
    status: 409,
    message: '该链接版本 30 天内已核实可用，请稍后再试'
  },
  rate_limited: { status: 429, message: '操作过于频繁，请稍后重试' },
  unavailable: { status: 503, message: '暂时无法完成操作，请稍后重试' }
} as const

export const LINK_HEALTH_CACHE_CONTROL = 'private, no-store'
export const BROKEN_LINK_INBOX_KIND = 'broken-link' as const
export const LINK_HEALTH_CASE_CONTEXT_KEY = 'link_health' as const

/** Acquire only the needed prefix/subsequence; never acquire in reverse. */
export const LINK_HEALTH_LOCK_ORDER = [
  'patch',
  'patch_resource',
  'patch_resource_link',
  'ops_case'
] as const
