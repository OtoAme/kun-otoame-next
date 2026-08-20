'use client'

import Link from 'next/link'
import { Tab, Tabs } from '@heroui/react'
import { usePathname } from 'next/navigation'

export const RankingNavigation = () => {
  const pathname = usePathname()
  const selectedKey = pathname.startsWith('/ranking/moemoepoint')
    ? 'moemoepoint'
    : 'otomegame'

  return (
    <Tabs
      aria-label="排行榜类型"
      color="primary"
      variant="underlined"
      selectedKey={selectedKey}
    >
      <Tab key="otomegame" as={Link} href="/ranking" title="OtomeGame 排行" />
      <Tab
        key="moemoepoint"
        as={Link}
        href="/ranking/moemoepoint"
        title="萌萌点排行"
      />
    </Tabs>
  )
}
