/**
 * 作者退出维护只有一套入口：DELETE 的 query action=handover|delete。
 * 请求动作不用 handed_over 或 deleted，条目删除不带 JSON body，
 * 也不另建工作台 handover 路径。本文件只描述请求，不自行发送。
 */

export const AUTHOR_RESOURCE_ACTIONS = ['handover', 'delete'] as const

export type AuthorResourceAction = (typeof AUTHOR_RESOURCE_ACTIONS)[number]

export const HANDOVER_CONFIRMATION =
  '交由站方维护后，你添加的链接会被移除，卡片和站方备份保留，仍署你的名字。你将不能再编辑这份资源，仍可在个人主页查看发布记录。已获得的萌萌点不收回，交接后暂不支持重新认领。'

export const DELETE_CONFIRMATION =
  '您确定要删除这条资源链接吗, 这将会导致您发布资源时获得的萌萌点奖励会被收回, 该操作不可撤销'

export const HANDOVER_SUCCESS = '已交由站方维护，你仍可在个人主页查看发布记录'

export const ACTION_STALE_NOTICE = '备份状态已变化，请重新确认'

export const BACKUP_CHANGED_NOTICE =
  '站方备份已变化，请重新确认是否交由站方维护'

export const BACKUP_MISSING_NOTICE =
  '这份资源还没有站方备份，请重新确认是否删除'

export type AuthorActionViewer = {
  userId: number
  userRole: number
  resourceUserId: number
  hasStaffBackup: boolean
  staffMaintained: boolean
}

/** 管理员仍走原来的删除。只有作者本人在未交接时二选一。 */
export const publisherExitAction = (
  viewer: AuthorActionViewer
): AuthorResourceAction | null => {
  if (viewer.userRole >= 3) return null
  if (!(viewer.userId > 0) || viewer.userId !== viewer.resourceUserId) {
    return null
  }
  if (viewer.staffMaintained) return null
  return viewer.hasStaffBackup ? 'handover' : 'delete'
}

/** 已交接的作者不能再编辑或删除。管理员不受这条约束。 */
export const authorResourceLocked = (viewer: AuthorActionViewer) =>
  viewer.userRole < 3 &&
  viewer.userId > 0 &&
  viewer.userId === viewer.resourceUserId &&
  viewer.staffMaintained

/** 作者走交接或删除；管理员始终明确删除。已交接作者没有动作。 */
export const confirmedExitAction = (
  viewer: AuthorActionViewer
): AuthorResourceAction | null => {
  if (authorResourceLocked(viewer)) return null
  return publisherExitAction(viewer) ?? (viewer.userRole >= 3 ? 'delete' : null)
}

export const authorActionLabel = (action: AuthorResourceAction) =>
  action === 'handover' ? '交由站方维护' : '删除资源'

export const authorActionConfirmation = (action: AuthorResourceAction) =>
  action === 'handover' ? HANDOVER_CONFIRMATION : DELETE_CONFIRMATION

export type AuthorConfirmState = {
  open: boolean
  shown: AuthorResourceAction | null
  notice: string
  error: string
  pending: boolean
}

export const closedAuthorConfirm = (): AuthorConfirmState => ({
  open: false,
  shown: null,
  notice: '',
  error: '',
  pending: false
})

export type AuthorConfirmEvent =
  | { type: 'open'; action: AuthorResourceAction }
  | { type: 'cancel' }
  | { type: 'confirm'; live: AuthorResourceAction | null }
  | { type: 'result'; ok: boolean; message?: string }

export const reduceAuthorConfirm = (
  state: AuthorConfirmState,
  event: AuthorConfirmEvent
): { state: AuthorConfirmState; write: AuthorResourceAction | null } => {
  if (event.type === 'open') {
    return {
      state: {
        open: true,
        shown: event.action,
        notice: '',
        error: '',
        pending: false
      },
      write: null
    }
  }
  if (!state.open) return { state, write: null }
  if (event.type === 'cancel') {
    if (state.pending) return { state, write: null }
    return { state: closedAuthorConfirm(), write: null }
  }
  if (event.type === 'confirm') {
    if (state.pending || state.shown === null) return { state, write: null }
    if (event.live !== state.shown) {
      return {
        state: {
          ...state,
          shown: event.live,
          notice: ACTION_STALE_NOTICE,
          error: '',
          pending: false
        },
        write: null
      }
    }
    return {
      state: { ...state, pending: true, error: '', notice: '' },
      write: event.live
    }
  }
  if (!state.pending) return { state, write: null }
  if (event.ok) return { state: closedAuthorConfirm(), write: null }
  return {
    state: {
      ...state,
      pending: false,
      error: event.message?.trim() || '操作失败，请稍后重试'
    },
    write: null
  }
}

export type PatchAuthorRequest = {
  method: 'DELETE'
  url: '/patch/resource'
  query: { resourceId: number; action: AuthorResourceAction }
}

export const patchAuthorRequest = (
  resourceId: number,
  action: AuthorResourceAction
): PatchAuthorRequest => ({
  method: 'DELETE',
  url: '/patch/resource',
  query: { resourceId, action }
})

export type WorkspaceAuthorRequest = {
  method: 'DELETE'
  url: `/workspace/resources/${number}`
  query: { action: AuthorResourceAction }
}

export const workspaceAuthorRequest = (
  resourceId: number,
  action: AuthorResourceAction
): WorkspaceAuthorRequest => ({
  method: 'DELETE',
  url: `/workspace/resources/${resourceId}`,
  query: { action }
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readBalance = (value: unknown) => {
  if (!isRecord(value)) return null
  const { total, reserved, available } = value
  if (
    typeof total !== 'number' ||
    typeof reserved !== 'number' ||
    typeof available !== 'number' ||
    !Number.isFinite(total) ||
    !Number.isFinite(reserved) ||
    !Number.isFinite(available)
  ) {
    return null
  }
  return { total, reserved, available }
}

export type PatchAuthorSuccess = {
  ok: true
  action: 'handed_over' | 'deleted'
  balanceUserId: number
  moemoepointBalance: { total: number; reserved: number; available: number }
}

const unconfirmed = (action: AuthorResourceAction) =>
  action === 'handover'
    ? '没有确认已交由站方维护。请刷新核对，不要再次提交。'
    : '没有确认删除是否已经完成，请刷新核对后再操作'

/** 条目成功只认 action。deleted:true 不能表示交接。 */
export const interpretPatchAuthorResponse = (
  requested: AuthorResourceAction,
  response: unknown
): PatchAuthorSuccess | { ok: false; message: string } => {
  if (typeof response === 'string') {
    return { ok: false, message: response.trim() || '操作失败，请稍后重试' }
  }
  if (!isRecord(response)) return { ok: false, message: unconfirmed(requested) }
  const expected = requested === 'handover' ? 'handed_over' : 'deleted'
  const balance = readBalance(response.moemoepointBalance)
  if (
    response.action !== expected ||
    typeof response.balanceUserId !== 'number' ||
    !Number.isSafeInteger(response.balanceUserId) ||
    !balance
  ) {
    return { ok: false, message: unconfirmed(requested) }
  }
  return {
    ok: true,
    action: expected,
    balanceUserId: response.balanceUserId,
    moemoepointBalance: balance
  }
}

export type WorkspaceAuthorSuccess = {
  ok: true
  action: 'handed_over' | 'deleted'
  moemoepointBalance?: { total: number; reserved: number; available: number }
}

/**
 * 工作台交接必须 deleted:false 且 handedOver:true。
 * 删除必须 deleted:true，且不能同时 handedOver:true。
 */
export const interpretWorkspaceAuthorResponse = (
  requested: AuthorResourceAction,
  response: unknown
): WorkspaceAuthorSuccess | { ok: false; message: string } => {
  if (typeof response === 'string') {
    return { ok: false, message: response.trim() || '操作失败，请稍后重试' }
  }
  if (!isRecord(response)) return { ok: false, message: unconfirmed(requested) }
  const balance =
    response.moemoepointBalance === undefined
      ? undefined
      : readBalance(response.moemoepointBalance)
  if (response.moemoepointBalance !== undefined && !balance) {
    return { ok: false, message: unconfirmed(requested) }
  }
  const moemoepointBalance = balance ?? undefined
  if (requested === 'handover') {
    if (response.deleted === false && response.handedOver === true) {
      return { ok: true, action: 'handed_over', moemoepointBalance }
    }
    return { ok: false, message: unconfirmed(requested) }
  }
  if (response.deleted === true && response.handedOver !== true) {
    return { ok: true, action: 'deleted', moemoepointBalance }
  }
  return { ok: false, message: unconfirmed(requested) }
}
