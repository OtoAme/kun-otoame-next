'use client'

import { Fragment, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import { useMounted } from '~/hooks/useMounted'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { useUserStore } from '~/store/userStore'
import { refreshUserSession } from '~/utils/sessionClient'
import { refreshPreferences } from '~/utils/preferenceClient'
import type { ReactNode } from 'react'

export const SessionContentBoundary = ({
  children,
  personalized = true
}: {
  children: ReactNode
  personalized?: boolean
}) => {
  const generation = useUserStore((state) => state.sessionGeneration)
  const status = useUserStore((state) => state.sessionStatus)
  const preferences = useAccountPreferences()
  const browsingKey = preferences.snapshot
    ? JSON.stringify([
        preferences.snapshot.items.nsfw.value,
        [...preferences.snapshot.blockedTagIds].sort(
          (first, second) => first - second
        )
      ])
    : null
  const [displayedBrowsingKey, setDisplayedBrowsingKey] = useState(browsingKey)
  const [displayedGeneration, setDisplayedGeneration] = useState(generation)
  const [refreshing, startTransition] = useTransition()
  const router = useRouter()
  const mounted = useMounted()
  useEffect(() => {
    if (
      displayedGeneration === generation &&
      displayedBrowsingKey === browsingKey
    )
      return
    startTransition(() => {
      setDisplayedGeneration(generation)
      setDisplayedBrowsingKey(browsingKey)
      router.refresh()
    })
  }, [
    displayedGeneration,
    generation,
    router,
    displayedBrowsingKey,
    browsingKey
  ])
  const pending =
    personalized &&
    mounted &&
    (status === 'checking' ||
      status === 'unavailable' ||
      (status === 'authenticated' && !preferences.snapshot) ||
      (status === 'authenticated' && displayedBrowsingKey !== browsingKey) ||
      refreshing ||
      displayedGeneration !== generation)
  return (
    <Fragment key={generation}>
      <div
        hidden={pending}
        inert={pending}
        style={{ display: pending ? 'none' : 'contents' }}
      >
        {children}
      </div>
      {pending && (
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
              <button
                type="button"
                onClick={() => {
                  void refreshPreferences()
                }}
              >
                重新读取设置
              </button>
            </>
          ) : (
            '正在确认会话…'
          )}
        </div>
      )}
    </Fragment>
  )
}
