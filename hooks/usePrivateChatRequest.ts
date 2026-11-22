'use client'

import { useCallback, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useUserStore } from '~/store/userStore'
import { KunFetchError } from '~/utils/kunFetch'
import { refreshUserSession } from '~/utils/sessionClient'

export const usePrivateChatRequest = (conversationId: number) => {
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
        current.sessionContext === context &&
        current.sessionGeneration === generation
      )
    }
    return {
      isCurrent,
      options: { timeout: 15_000, preserveErrorStatus: true as const },
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
