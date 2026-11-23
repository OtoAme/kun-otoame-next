'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { SessionRenderState } from '~/types/api/session'

const SessionRenderContext = createContext<SessionRenderState | null>(null)

export const useSessionRenderState = () => useContext(SessionRenderContext)

export const SessionRenderProvider = ({
  initialState,
  children
}: {
  initialState: SessionRenderState | null
  children: ReactNode
}) => (
  <SessionRenderContext.Provider value={initialState}>
    {children}
  </SessionRenderContext.Provider>
)
