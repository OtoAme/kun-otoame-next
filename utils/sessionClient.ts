import toast from 'react-hot-toast'
import { useUserStore } from '~/store/userStore'
import { useSettingStore } from '~/store/settingStore'
import { useMessageStore } from '~/store/messageStore'
import { withSessionMutation } from '~/utils/sessionMutation'
import { beginUnreadRead, seedSessionUnread } from '~/utils/messageSync'
import type { UserSession } from '~/types/api/session'

const acceptSessionSummary = (session: UserSession, readVersion: number) => {
  useUserStore.getState().acceptSession(session.user, session.context)
  const current = useUserStore.getState()
  if (
    current.sessionStatus === 'authenticated' &&
    current.sessionContext === session.context &&
    seedSessionUnread(
      {
        context: current.sessionContext,
        generation: current.sessionGeneration
      },
      session.unread,
      readVersion
    )
  ) {
    useMessageStore.getState().setUnreadMessageStatus(session.unread!)
  }
}

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
      const readVersion = beginUnreadRead()
      const response = await fetch('/api/user/session', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Requested-With': 'kun-fetch' }
      })
      const body = await response.json()
      if (useUserStore.getState().sessionGeneration !== generation) return
      if (response.status === 401 && body?.code === 'SESSION_INVALID') {
        await withSessionMutation(async (request) => {
          if (useUserStore.getState().sessionGeneration !== generation) return
          const freshReadVersion = beginUnreadRead()
          const fresh = await fetch('/api/user/session', {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'X-Requested-With': 'kun-fetch' }
          })
          const latest = await fresh.json()
          if (useUserStore.getState().sessionGeneration !== generation) return
          if (fresh.ok && latest?.context && latest?.user?.uid) {
            acceptSessionSummary(latest as UserSession, freshReadVersion)
            return
          }
          if (fresh.status !== 401 || latest?.code !== 'SESSION_INVALID') {
            useUserStore.getState().setSessionStatus('unavailable')
            return
          }
          const cleanup = await request<{ cleared?: boolean }>(
            '/api/user/session',
            {
              method: 'DELETE'
            }
          )
          if (useUserStore.getState().sessionGeneration !== generation) return
          if (!cleanup.ok || cleanup.body?.cleared !== true) {
            useUserStore.getState().setSessionStatus('unavailable')
            return
          }
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
        })
        return
      }
      if (!response.ok || !body?.context || !body?.user?.uid) {
        useUserStore.getState().setSessionStatus('unavailable')
        return
      }
      const session = body as UserSession
      acceptSessionSummary(session, readVersion)
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
  const { sessionGeneration: generation, sessionContext: context } =
    useUserStore.getState()
  return withSessionMutation(async (request) => {
    if (useUserStore.getState().sessionGeneration !== generation) return null
    const response = await request<{ revoked: boolean; message: string }>(
      '/api/user/status/logout',
      context ? { body: { context } } : undefined
    )
    if (
      useUserStore.getState().sessionGeneration !== generation ||
      useUserStore.getState().sessionContext !== context
    )
      return null
    const body = response.body
    if (response.status === 409) {
      useUserStore.getState().setSessionStatus('unavailable')
      throw new Error('登录状态已变化，请重新确认当前账号后重试退出')
    }
    if (
      typeof body?.revoked !== 'boolean' ||
      (response.status !== 200 && response.status !== 503)
    ) {
      throw new Error('退出登录失败，请稍后重试')
    }
    pending?.controller.abort()
    useUserStore.getState().logout()
    return body
  })
}
