'use client'

import { Card, CardBody } from '@heroui/card'
import { Tab, Tabs } from '@heroui/tabs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUserStore } from '~/store/userStore'

interface UserActivityProps {
  id: number
}

export const UserActivity = ({ id }: UserActivityProps) => {
  const pathname = usePathname()
  const lastSegment = pathname.split('/').filter(Boolean).pop()
  const viewerId = useUserStore((state) => state.user.uid)

  const tabs = [
    { key: 'comment', title: '评论', href: `/user/${id}/comment` },
    { key: 'favorite', title: '收藏夹', href: `/user/${id}/favorite` },
    { key: 'resource', title: '发布资源', href: `/user/${id}/resource` },
    // Submissions are drafts and review outcomes, so the tab exists only on
    // your own profile.
    ...(viewerId === id
      ? [{ key: 'submission', title: '我的投稿', href: `/user/${id}/submission` }]
      : [])
  ]

  return (
    <Card className="w-full">
      <CardBody>
        <Tabs
          aria-label="用户活动"
          variant="underlined"
          fullWidth
          selectedKey={lastSegment}
        >
          {tabs.map(({ key, title, href }) => (
            <Tab key={key} as={Link} title={title} href={href} />
          ))}
        </Tabs>
      </CardBody>
    </Card>
  )
}
