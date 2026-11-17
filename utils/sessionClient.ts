import toast from 'react-hot-toast'
import { useUserStore } from '~/store/userStore'
import { useSettingStore } from '~/store/settingStore'
import { useMessageStore } from '~/store/messageStore'
import type { UserSession } from '~/types/api/session'

let pending: {
  generation: number
  promise: Promise<void>
  controller: AbortController
} | null = null

export const refreshUserSession = () => {
  const previousStatus = useUserStore.getState().sessionStatus
  const generation = useUserStore.getState().sessionGeneration
  if (pending?.generation === generation) return pending.promise
  pending?.controller.abort()
  const controller = new AbortController()
  useUserStore.getState().setSessionStatus('checking')
  const promise = (async () => {
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch('/api/user/session', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Requested-With': 'kun-fetch' }
      })
      const body = await response.json()
      if (useUserStore.getState().sessionGeneration !== generation) return
      if (response.status === 401 && body?.code === 'SESSION_INVALID') {
        const state = useUserStore.getState()
        if (
          state.user.uid ||
          state.sessionContext ||
          previousStatus !== 'guest'
        ) {
          const hadAccount = Boolean(state.user.uid || state.sessionContext)
          state.logout()
          if (hadAccount)
            toast.error(body.message || '登录状态已失效，请重新登录')
        } else {
          useSettingStore.getState().resetData()
          useMessageStore.getState().resetUnreadMessageStatus()
          state.setSessionStatus('guest')
        }
        return
      }
      if (!response.ok || !body?.context || !body?.user?.uid) {
        useUserStore.getState().setSessionStatus('unavailable')
        return
      }
      const session = body as UserSession
      useUserStore.getState().acceptSession(session.user, session.context)
      if (session.unread !== null)
        useMessageStore.getState().setUnreadMessageStatus(session.unread)
    } catch {
      if (useUserStore.getState().sessionGeneration === generation) {
        useUserStore.getState().setSessionStatus('unavailable')
      }
    } finally {
      clearTimeout(timeout)
    }
  })().finally(() => {
    if (pending?.promise === promise) pending = null
  })
  pending = { generation, promise, controller }
  return promise
}

export const requestUserLogout = async () => {
  const generation = useUserStore.getState().sessionGeneration
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch('/api/user/status/logout', {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: { 'X-Requested-With': 'kun-fetch' }
    })
    const body = await response.json()
    if (useUserStore.getState().sessionGeneration !== generation) return null
    if (
      typeof body?.revoked !== 'boolean' ||
      (response.status !== 200 && response.status !== 503)
    ) {
      throw new Error('退出登录失败，请稍后重试')
    }
    pending?.controller.abort()
    useUserStore.getState().logout()
    return body as { revoked: boolean; message: string }
  } finally {
    clearTimeout(timeout)
  }
}
