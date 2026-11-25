'use client'

import { useEffect, useState } from 'react'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Button } from '@heroui/button'
import { Select, SelectItem } from '@heroui/select'
import type { ProfileContributionDay } from '~/types/api/user'
import { ContributionCalendar } from './ContributionCalendar'
import { KunLoading } from '~/components/kun/Loading'
import { kunFetchGet } from '~/utils/kunFetch'

function YearCalendar({ uid, year }: { uid: number; year?: number }) {
  const [days, setDays] = useState<ProfileContributionDay[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    kunFetchGet<ProfileContributionDay[]>(
      '/user/profile/contributions',
      year === undefined ? { uid } : { uid, year },
      { signal: controller.signal, preserveErrorStatus: true }
    )
      .then((data) => {
        if (!controller.signal.aborted) setDays(data)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [uid, year, attempt])

  if (failed)
    return (
      <div
        className="flex min-h-32 items-center justify-center gap-2"
        role="alert"
      >
        贡献记录加载失败
        <Button
          size="sm"
          variant="light"
          onPress={() => {
            setFailed(false)
            setAttempt(attempt + 1)
          }}
        >
          重试
        </Button>
      </div>
    )
  if (!days) return <KunLoading hint="正在加载贡献记录..." />

  return <ContributionCalendar days={days} year={year} />
}

export function UserContributions({
  uid,
  firstYear,
  currentYear
}: {
  uid: number
  firstYear: number
  currentYear: number
}) {
  const [period, setPeriod] = useState('recent')
  const years = Array.from(
    { length: currentYear - Math.min(firstYear, currentYear) + 1 },
    (_, i) => currentYear - i
  )
  return (
    <Card>
      <CardHeader className="justify-between gap-4 px-4 pb-1">
        <h2 className="text-lg font-semibold">社区贡献</h2>
        <Select
          aria-label="贡献年份"
          disallowEmptySelection
          size="sm"
          className="w-28"
          selectedKeys={[period]}
          onChange={(event) => {
            if (event.target.value) setPeriod(event.target.value)
          }}
        >
          {['recent', ...years].map((item) => (
            <SelectItem key={item}>
              {item === 'recent' ? '最近一年' : String(item)}
            </SelectItem>
          ))}
        </Select>
      </CardHeader>
      <CardBody className="p-4">
        <YearCalendar
          key={period}
          uid={uid}
          year={period === 'recent' ? undefined : Number(period)}
        />
      </CardBody>
    </Card>
  )
}
