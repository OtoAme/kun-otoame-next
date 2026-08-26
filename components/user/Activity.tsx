'use client'

import { Card, CardBody } from '@heroui/card'
import { Tab, Tabs } from '@heroui/tabs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

interface UserActivityProps {
  id: number
}

export const UserActivity = ({ id }: UserActivityProps) => {
  const pathname = usePathname()
  const lastSegment = pathname.split('/').filter(Boolean).pop()

  const tabs = [
    { key: 'comment', title: '评论', href: `/user/${id}/comment` },
    { key: 'favorite', title: '收藏夹', href: `/user/${id}/favorite` },
    { key: 'resource', title: '发布资源', href: `/user/${id}/resource` },
    // One tab for everyone: the owner manages their submissions here, visitors
    // see only the approved, published entries.
    { key: 'submission', title: '发布条目', href: `/user/${id}/submission` }
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
