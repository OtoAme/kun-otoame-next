'use client'

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition
} from 'react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { useSessionRenderState } from './SessionRenderProvider'
import { getBrowsingKey } from '~/utils/browsingScope'
import { refreshPreferences } from '~/utils/preferenceClient'
import { useUserStore } from '~/store/userStore'
import { refreshUserSession } from '~/utils/sessionClient'
import type { ReactNode } from 'react'

const SessionContentReadyContext = createContext(true)

export const useSessionContentReady = () =>
  useContext(SessionContentReadyContext)

export const SessionContentBoundary = ({
  children,
  personalized = true,
  usesBrowsingPreferences = true
}: {
  children: ReactNode
  personalized?: boolean
  usesBrowsingPreferences?: boolean
}) =>
  personalized ? (
    <PersonalizedContent usesBrowsingPreferences={usesBrowsingPreferences}>
      {children}
    </PersonalizedContent>
  ) : (
    children
  )

const PersonalizedContent = ({
  children,
  usesBrowsingPreferences
}: {
  children: ReactNode
  usesBrowsingPreferences: boolean
}) => {
  const generation = useUserStore((state) => state.sessionGeneration)
  const status = useUserStore((state) => state.sessionStatus)
  const context = useUserStore((state) => state.sessionContext)
  const preferences = useAccountPreferences()
  const initialState = useSessionRenderState()
  const identity =
    status === 'guest' ? 'guest' : status === 'authenticated' ? context : null
  const browsingKey =
    status === 'guest'
      ? getBrowsingKey('sfw', [])
      : preferences.snapshot
        ? getBrowsingKey(
            String(preferences.snapshot.items.nsfw.value),
            preferences.snapshot.blockedTagIds
          )
        : null
  const [displayed, setDisplayed] = useState(
    () =>
      initialState ??
      (identity && (browsingKey !== null || !usesBrowsingPreferences)
        ? { identity, browsingKey }
        : null)
  )
  const [displayedGeneration, setDisplayedGeneration] = useState(generation)
  const confirmed = useRef(
    identity !== null && (browsingKey !== null || !usesBrowsingPreferences)
  )
  const [contentVersion, setContentVersion] = useState(0)
  const [refreshing, startTransition] = useTransition()
  const router = useRouter()
  useEffect(() => {
    if (!identity || (usesBrowsingPreferences && browsingKey === null)) return
    if (
      displayed?.identity === identity &&
      (!usesBrowsingPreferences || displayed.browsingKey === browsingKey) &&
      (!confirmed.current || displayedGeneration === generation)
    ) {
      confirmed.current = true
      if (displayedGeneration !== generation) setDisplayedGeneration(generation)
      if (displayed.browsingKey !== browsingKey)
        setDisplayed({ identity, browsingKey })
      return
    }
    const identityChanged =
      displayed?.identity !== identity ||
      (confirmed.current && displayedGeneration !== generation)
    confirmed.current = true
    // Reset old account state before the transition so an existing Suspense
    // boundary keeps content unready until the refreshed server page resolves.
    if (identityChanged) setContentVersion((version) => version + 1)
    startTransition(() => {
      setDisplayedGeneration(generation)
      setDisplayed({ identity, browsingKey })
      router.refresh()
    })
  }, [
    displayed,
    displayedGeneration,
    generation,
    identity,
    browsingKey,
    usesBrowsingPreferences,
    router
  ])
  const changed =
    identity !== null &&
    (displayed?.identity !== identity ||
      (usesBrowsingPreferences &&
        browsingKey !== null &&
        displayed.browsingKey !== browsingKey))
  const invalidated =
    generation !== displayedGeneration &&
    (confirmed.current || identity === null)
  const pending = !displayed || invalidated || changed || refreshing
  const ready =
    !pending &&
    identity !== null &&
    (!usesBrowsingPreferences || browsingKey !== null)
  const preferenceFailed =
    usesBrowsingPreferences &&
    status === 'authenticated' &&
    !preferences.snapshot &&
    preferences.status === 'error'
  return (
    <Fragment key={contentVersion}>
      <SessionContentReadyContext.Provider value={ready}>
        <div
          hidden={pending}
          inert={pending}
          style={{ display: pending ? 'none' : 'contents' }}
        >
          {children}
        </div>
        {(pending || status === 'unavailable' || preferenceFailed) && (
          <div role="status" className="p-6 text-center">
            {status === 'unavailable' ? (
              <>
                会话验证暂时不可用，
                <Link
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    void refreshUserSession()
                  }}
                >
                  点击重试
                </Link>
              </>
            ) : status === 'authenticated' && preferences.status === 'error' ? (
              <>
                浏览偏好读取失败，
                <Link
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    void refreshPreferences()
                  }}
                >
                  重新读取设置
                </Link>
              </>
            ) : (
              '正在确认会话…'
            )}
          </div>
        )}
      </SessionContentReadyContext.Provider>
    </Fragment>
  )
}
