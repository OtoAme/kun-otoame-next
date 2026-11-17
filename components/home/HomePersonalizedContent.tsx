'use client'
import { useEffect, useState } from 'react'
import { Button } from '@heroui/button'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { ResourceCard } from '~/components/resource/ResourceCard'
import { HomeGalgameGrid } from './HomeGalgameGrid'
import { useUserStore } from '~/store/userStore'
import { useAccountPreferences } from '~/hooks/useAccountPreferences'
import { kunFetchGet } from '~/utils/kunFetch'
import type { HomeResource } from '~/types/api/home'

type HomeData = { galgames: GalgameCard[]; resources: HomeResource[] }
export const HomePersonalizedContent = ({
  publicData
}: {
  publicData: HomeData
}) => {
  const session = useUserStore()
  const preferences = useAccountPreferences()
  const ready =
    session.sessionStatus === 'guest' ||
    (session.sessionStatus === 'authenticated' &&
      preferences.snapshot !== null &&
      preferences.status === 'ready')
  const key = ready
    ? `${session.sessionGeneration}:${session.sessionContext ?? 'guest'}:${preferences.snapshot?.version ?? 0}`
    : null
  const [result, setResult] = useState<{ key: string; data: HomeData } | null>(
    null
  )
  const [failed, setFailed] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!key || session.sessionStatus !== 'authenticated') return
    let ignore = false
    const controller = new AbortController()
    setFailed(null)
    void kunFetchGet<HomeData>('/home', undefined, {
      signal: controller.signal,
      preserveErrorStatus: true
    })
      .then((data) => {
        if (!ignore) setResult({ key, data })
      })
      .catch(() => {
        if (!ignore) setFailed(key)
      })
    return () => {
      ignore = true
      controller.abort()
    }
  }, [key, retry, session.sessionStatus])
  const data =
    session.sessionStatus === 'guest'
      ? publicData
      : result?.key === key
        ? result.data
        : null
  if (!ready || (!data && failed !== key))
    return (
      <div role="status" className="space-y-6">
        <p>最新游戏：正在确认浏览偏好…</p>
        <p>最新补丁：正在确认浏览偏好…</p>
      </div>
    )
  if (failed === key)
    return (
      <div role="status">
        首页内容读取失败。
        <Button onPress={() => setRetry((value) => value + 1)}>重试</Button>
      </div>
    )
  const { galgames, resources } = data!
  return (
    <div className="space-y-8">
      <section className="kun-home-game-section space-y-6">
        <div className="flex items-center space-x-4">
          <h2 className="kun-home-section-title text-lg font-bold sm:text-2xl">
            最新游戏
          </h2>
          <Button
            className="kun-home-section-more-button"
            variant="light"
            as={Link}
            color="primary"
            endContent={<ChevronRight className="size-4" />}
            href="/otomegame"
          >
            查看更多
          </Button>
        </div>
        <HomeGalgameGrid galgames={galgames} />
      </section>

      <section className="space-y-6">
        <div className="flex items-center space-x-4">
          <h2 className="kun-home-section-title text-lg font-bold sm:text-2xl">
            最新补丁
          </h2>
          <Button
            className="kun-home-section-more-button"
            variant="light"
            as={Link}
            color="primary"
            endContent={<ChevronRight className="size-4" />}
            href="/resource"
          >
            查看更多
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:gap-6 md:grid-cols-2">
          {resources.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
      </section>
      {!galgames.length && <p>当前条件下没有最新游戏</p>}
      {!resources.length && <p>当前条件下没有最新补丁</p>}
    </div>
  )
}
