'use client'

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
  useTransition
} from 'react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import { useUserStore } from '~/store/userStore'
import { refreshUserSession } from '~/utils/sessionClient'
import type { ReactNode } from 'react'

const SessionContentReadyContext = createContext(true)

export const useSessionContentReady = () =>
  useContext(SessionContentReadyContext)

export const SessionContentBoundary = ({
  children,
  personalized = true
}: {
  children: ReactNode
  personalized?: boolean
}) => {
  const generation = useUserStore((state) => state.sessionGeneration)
  const status = useUserStore((state) => state.sessionStatus)
  const [displayedGeneration, setDisplayedGeneration] = useState(generation)
  const [refreshing, startTransition] = useTransition()
  const router = useRouter()
  useEffect(() => {
    if (displayedGeneration === generation) return
    startTransition(() => {
      setDisplayedGeneration(generation)
      if (personalized) router.refresh()
    })
  }, [displayedGeneration, generation, personalized, router])
  const pending =
    personalized &&
    (status === 'checking' ||
      status === 'unavailable' ||
      refreshing ||
      displayedGeneration !== generation)
  return (
    <Fragment key={personalized ? generation : 'public'}>
      <SessionContentReadyContext.Provider value={!pending}>
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
            ) : (
              '正在确认会话…'
            )}
          </div>
        )}
      </SessionContentReadyContext.Provider>
    </Fragment>
  )
}
