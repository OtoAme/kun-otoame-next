'use client'

import { createContext, useContext } from 'react'
import type { WorkspaceUser } from '~/types/api/workspace'

const WorkspaceUserContext = createContext<WorkspaceUser | null>(null)

export function WorkspaceUserProvider({
  user,
  children
}: {
  user: WorkspaceUser
  children: React.ReactNode
}) {
  return (
    <WorkspaceUserContext.Provider value={user}>
      {children}
    </WorkspaceUserContext.Provider>
  )
}

export function useWorkspaceUser(): WorkspaceUser {
  const user = useContext(WorkspaceUserContext)
  if (!user) {
    throw new Error('useWorkspaceUser must be used within WorkspaceShell')
  }
  return user
}

/** 工作台外没有 provider 时返回 null，不打断事项详情等复用方。 */
export function useOptionalWorkspaceUser(): WorkspaceUser | null {
  return useContext(WorkspaceUserContext)
}
