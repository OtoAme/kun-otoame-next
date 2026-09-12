'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { QueryClient } from '@tanstack/react-query'
import { useSettingStore } from '~/store/settingStore'
import { useUserStore } from '~/store/userStore'
import {
  getShoutboxContextKeyPart,
  isShoutboxQueryKey,
  normalizeShoutboxContext,
  shoutboxQueryKeyMatchesContext
} from './core'
import type { ReactNode } from 'react'
import type { ShoutboxRequestContext } from '~/types/api/shoutbox'

interface ShoutboxQueryContextValue {
  client: QueryClient
  /** False during SSR and the first client render; flips true once after the
   *  first client effect and never resets on client-side navigation. */
  clientReady: boolean
  /** The context the API would apply right now (auth + preference cookies). */
  scope: ShoutboxRequestContext
  /** Live read of { clientReady, scope } at CALL time: a write that started
   *  before an account switch must not act on the old render's scope. */
  getCurrent: () => { clientReady: boolean; scope: ShoutboxRequestContext }
}

const ShoutboxQueryContext = createContext<ShoutboxQueryContextValue | null>(
  null
)

/** Null-safe accessor for write paths (edit/delete/publish/report/admin):
 *  components rendered outside the provider (unit tests) simply skip the
 *  public-cache notification. */
export const useShoutboxQueryContextOrNull =
  (): ShoutboxQueryContextValue | null => useContext(ShoutboxQueryContext)

export const useShoutboxQueryContext = (): ShoutboxQueryContextValue => {
  const context = useContext(ShoutboxQueryContext)
  if (!context) {
    throw new Error(
      'useShoutboxQueryContext must be used within ShoutboxQueryProvider'
    )
  }
  return context
}

/**
 * One stable QueryClient per root layout (the site root and the dashboard
 * root each mount their own provider). SSR renders of client components
 * create a fresh client per request inside useState, so no instance is ever
 * shared across SSR requests. On account or preference changes the previous
 * scope's public queries are cancelled and removed so stale responses can
 * never surface under the new scope.
 */
export const ShoutboxQueryProvider = ({
  children
}: {
  children: ReactNode
}) => {
  const [client] = useState(() => new QueryClient())
  const [clientReady, setClientReady] = useState(false)
  useEffect(() => {
    setClientReady(true)
  }, [])

  const uid = useUserStore((state) => state.user.uid)
  const nsfw = useSettingStore((state) => state.data.kunNsfwEnable)
  const blockedTagIds = useSettingStore((state) => state.data.kunBlockedTagIds)

  const scope = useMemo(
    () =>
      normalizeShoutboxContext({
        uid,
        nsfw,
        blockedTags: blockedTagIds
      }),
    [uid, nsfw, blockedTagIds]
  )
  const scopeKey = getShoutboxContextKeyPart(scope)

  const previousScopeKeyRef = useRef(scopeKey)
  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) {
      return
    }
    previousScopeKeyRef.current = scopeKey
    const isOutdatedScope = (queryKey: readonly unknown[]) =>
      isShoutboxQueryKey(queryKey) &&
      !shoutboxQueryKeyMatchesContext(queryKey, scope)
    void client
      .cancelQueries({ predicate: (query) => isOutdatedScope(query.queryKey) })
      .then(() =>
        client.removeQueries({
          predicate: (query) => isOutdatedScope(query.queryKey)
        })
      )
  }, [client, scope, scopeKey])

  const liveRef = useRef({ clientReady, scope })
  liveRef.current = { clientReady, scope }
  const getCurrent = useCallback(() => liveRef.current, [])

  const value = useMemo(
    () => ({ client, clientReady, scope, getCurrent }),
    [client, clientReady, scope, getCurrent]
  )

  return (
    <ShoutboxQueryContext.Provider value={value}>
      {children}
    </ShoutboxQueryContext.Provider>
  )
}
