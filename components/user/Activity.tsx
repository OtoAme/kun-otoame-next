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
    // Public published entries. Drafts and quota live in the workspace.
    { key: 'submission', title: '发布条目', href: `/user/${id}/submission` },
    // The shoutbox tab lists the author's records: the author and site staff
    // see every status, other logged-in users only the public ones.
    { key: 'shoutbox', title: '小喇叭', href: `/user/${id}/shoutbox` },
    ...(viewerId === id
      ? [{ key: 'workspace', title: '工作台', href: '/workspace/entries' }]
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
