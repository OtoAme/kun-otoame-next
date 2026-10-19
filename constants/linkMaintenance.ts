export const LINK_MAINTENANCE_STATES = [
  'pending',
  'snoozed',
  'optional',
  'handled',
  'stopped'
] as const
export const LINK_MAINTENANCE_ACTIONS = [
  'respond',
  'verify',
  'snooze',
  'stop',
  'resume'
] as const
export const LINK_MAINTENANCE_OUTCOMES = [
  'explained',
  'verified',
  'relinked',
  'stopped',
  'removed'
] as const
export const LINK_MAINTENANCE_SNOOZE_DAYS = [1, 3] as const
export const LINK_MAINTENANCE_NOTE_MAX = 1007

export const LINK_MAINTENANCE_ERRORS = {
  invalid_request: { status: 400, message: '维护请求格式不正确' },
  forbidden: { status: 403, message: '您没有权限维护该链接' },
  not_found: { status: 404, message: '链接不存在或不可访问' },
  state_conflict: {
    status: 409,
    message: '该链接的维护状态已变化，请刷新后重试'
  },
  no_active_event: { status: 409, message: '该链接当前没有待回应的反馈' },
  feedback_snoozed: {
    status: 409,
    message: '发布者已暂缓维护，请在恢复后再反馈'
  },
  feedback_stopped: {
    status: 409,
    message: '发布者已停止维护该链接，暂不接受失效反馈'
  }
} as const
