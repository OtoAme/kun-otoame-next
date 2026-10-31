'use client'

import Link from 'next/link'
import { ExternalLink, Unlink } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent, CardHeader } from '~/components/dashboard/ui/card'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { BrokenLinkInboxItem } from '~/types/api/inbox'

interface BrokenLinkInboxDetailProps {
  item: BrokenLinkInboxItem
  onProcessed: (key: string) => void
}

const brokenDurationText = (seconds: number | null): string => {
  if (seconds === null) return '失效时长未知'
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `已失效 ${days} 天`
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) return `已失效 ${hours} 小时`
  return '失效不足 1 小时'
}

/**
 * 资源盘（touchgal）失效链接的站方待办。载荷只有脱敏上下文，不含地址与
 * 提取码/解压码。这里不直接写入：补链与移除都在同一个既有受权资源编辑
 * 路径里完成（携带完整 baseLinks 的整表单保存），最后一条链接只能改地址
 * （actions.remove === false）。绝不分发整条资源的 DELETE。
 */
export function BrokenLinkInboxDetail({ item }: BrokenLinkInboxDetailProps) {
  const { link, actions } = item.payload
  // 编辑走后端下发的唯一受权编辑路径（旧后台整表单、完整基点、定位到该链接）；
  // 查看链接在前台资源页，同样定位到这条资源；无整条资源 DELETE。
  const editorHref = item.targetHref
  const resourceHref = `/${link.patch.uniqueId}?tab=resources&resourceSection=${link.resource.section}&resourceId=${link.resourceId}`

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
        <Unlink className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">资源盘链接失效</h3>
        <Badge variant="destructive">已失效</Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">所属条目</dt>
          <dd className="min-w-0 truncate">
            {link.patch.name || link.patch.uniqueId}
          </dd>
          <dt className="text-muted-foreground">所属资源</dt>
          <dd className="min-w-0 truncate">
            {link.resource.name || '资源备注'}
          </dd>
          <dt className="text-muted-foreground">网盘主机</dt>
          <dd>{link.hostname ?? '无法解析'}</dd>
          <dt className="text-muted-foreground">失效时长</dt>
          <dd>{brokenDurationText(link.brokenForSeconds)}</dd>
          {link.healthChangedAt && (
            <>
              <dt className="text-muted-foreground">进入失效</dt>
              <dd>{formatChinaDateTime(link.healthChangedAt)}</dd>
            </>
          )}
        </dl>

        {actions.remove ? null : (
          <p className="text-muted-foreground">
            这是资源的最后一条链接，只能改地址，不能删除。
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" asChild>
            <Link href={editorHref}>
              <ExternalLink className="size-4" aria-hidden />
              编辑链接
            </Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={resourceHref}>查看资源</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
