'use client'

import Link from 'next/link'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent } from '~/components/dashboard/ui/card'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_TYPE_MAP,
  sortResourceTypes
} from '~/constants/resource'
import type { WorkspaceResourceSummary } from '~/types/api/workspace'
import { workspaceResourceHref } from '~/utils/workspaceRoutes'
import { WorkspaceBanner } from './WorkspaceBanner'

export const workspaceResourceStatusLabel = (status: number) => {
  if (status === 0) return '正常'
  if (status === 2) return '待审核'
  if (status === 1) return '已封禁'
  return `状态 ${status}`
}

/**
 * Resource row card mirroring the public horizontal cover layout: cover left
 * and content right on desktop, stacked on narrow screens. The cover itself
 * is not a link; the single workspace entry is the edit/view button.
 */
export function WorkspaceResourceCard({
  item
}: {
  item: WorkspaceResourceSummary
}) {
  return (
    <Card>
      <CardContent className="flex min-w-0 flex-col gap-4 pt-4 sm:flex-row">
        <div className="relative h-40 w-full shrink-0 sm:h-auto sm:w-40">
          <WorkspaceBanner banner={item.patchBanner} alt={item.patchName} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-all font-semibold">{item.patchName}</h2>
              <p className="break-all text-sm text-muted-foreground">
                {item.name || '未命名资源'}
              </p>
            </div>
            <Badge variant="secondary">
              {workspaceResourceStatusLabel(item.status)}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {sortResourceTypes(item.type).map((value) => (
              <Badge key={`type-${value}`} variant="outline">
                {SUPPORTED_TYPE_MAP[value] ?? value}
              </Badge>
            ))}
            {item.language.map((value) => (
              <Badge key={`language-${value}`} variant="outline">
                {SUPPORTED_LANGUAGE_MAP[value] ?? value}
              </Badge>
            ))}
            {item.platform.map((value) => (
              <Badge key={`platform-${value}`} variant="outline">
                {SUPPORTED_PLATFORM_MAP[value] ?? value}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{RESOURCE_SECTION_MAP[item.section] ?? item.section}</span>
            <span>{new Date(item.created).toLocaleDateString('zh-CN')}</span>
            <span>{item.linkCount} 条链接</span>
            {item.actionableCount > 0 ? (
              <Badge>{item.actionableCount} 条待处理</Badge>
            ) : null}
          </div>
          <div>
            <Button asChild size="sm" variant="outline">
              <Link href={workspaceResourceHref(item.id)}>
                {item.capabilities.canEdit ? '编辑' : '查看'}
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
