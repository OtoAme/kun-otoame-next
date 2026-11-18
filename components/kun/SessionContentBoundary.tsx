'use client'

import { Fragment, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import { refreshUserSession } from '~/utils/sessionClient'
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
  const [displayedGeneration, setDisplayedGeneration] = useState(generation)
  const [refreshing, startTransition] = useTransition()
  const router = useRouter()
  const mounted = useMounted()
  useEffect(() => {
    if (displayedGeneration === generation) return
    startTransition(() => {
      setDisplayedGeneration(generation)
      router.refresh()
    })
  }, [displayedGeneration, generation, router])
  const pending =
    personalized &&
    mounted &&
    (status === 'checking' ||
      status === 'unavailable' ||
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
          ) : (
            '正在确认会话…'
          )}
        </div>
      )}
    </Fragment>
  )
}
