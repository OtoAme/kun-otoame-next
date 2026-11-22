'use client'

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef
} from 'react'
import toast from 'react-hot-toast'
import { useUserStore } from '~/store/userStore'
import { KunFetchError } from '~/utils/kunFetch'
import { refreshUserSession } from '~/utils/sessionClient'

// An opened conversation can stay on screen after its owner signs out.
export const ChatWriteSession = createContext<string | null | undefined>(
  undefined
)

export const usePrivateChatRequest = (conversationId: number) => {
  const allowedContext = useContext(ChatWriteSession)
  const allowedRef = useRef(allowedContext)
  allowedRef.current = allowedContext
  const conversationRef = useRef(conversationId)
  conversationRef.current = conversationId
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return useCallback(() => {
    const identity = useUserStore.getState()
    const context = identity.sessionContext
    const generation = identity.sessionGeneration
    const target = conversationRef.current
    if (
      allowedRef.current !== undefined &&
      (!allowedRef.current || allowedRef.current !== context)
    )
      return null
    if (identity.sessionStatus !== 'authenticated' || !context) {
      void refreshUserSession()
      return null
    }
    const isCurrent = () => {
      const current = useUserStore.getState()
      return (
        mountedRef.current &&
        conversationRef.current === target &&
        current.sessionStatus === 'authenticated' &&
        (allowedRef.current === undefined || allowedRef.current === context) &&
        current.sessionContext === context &&
        current.sessionGeneration === generation
      )
    }
    return {
      isCurrent,
      options: {
        timeout: 15_000,
        preserveErrorStatus: true as const,
        headers: { 'X-Kun-Chat-Session': context }
      },
      fail: (error: unknown, fallback: string) => {
        if (!isCurrent()) return
        if (error instanceof KunFetchError && error.status === 401) {
          void refreshUserSession()
          return
        }
        const body = error instanceof KunFetchError ? error.body : null
        const message =
          typeof body === 'string'
            ? body
            : body &&
                typeof body === 'object' &&
                'message' in body &&
                typeof body.message === 'string'
              ? body.message
              : fallback
        toast.error(message)
      }
    }
  }, [])
}
