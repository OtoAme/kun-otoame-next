'use client'

import { Button, Card, CardBody, CardHeader } from '@heroui/react'
import Link from 'next/link'
import { Plus } from 'lucide-react'

/**
 * Admins publish through the editor rather than the review queue, so their own
 * profile tab offers that directly: no deposit is held and no submission quota
 * applies to them.
 */
export const AdminEntryPanel = () => {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-xl">直接创建条目</h2>
        <p className="text-sm text-default-500">
          作为管理员, 您可以直接创建游戏条目, 无需投稿审核, 也不会暂扣萌萌点。
        </p>
      </CardHeader>
      <CardBody>
        <Button
          as={Link}
          href="/edit/create"
          color="primary"
          startContent={<Plus className="size-4" />}
        >
          新建条目
        </Button>
      </CardBody>
    </Card>
  )
}
