'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent, CardHeader } from '~/components/dashboard/ui/card'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { kunFetchPost } from '~/utils/kunFetch'
import { cn } from '~/lib/dashboard/utils'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type {
  LinkHealthBasis,
  LinkHealthListRow,
  LinkHealthMutationResponse
} from '~/types/api/linkHealth'
import { LINK_HEALTH_LABELS } from '~/components/patch/resource/linkHealthDisplay'
import type { UseLinkRepairListReturn } from './useLinkRepairList'

type PendingAction = 'verify' | 'confirm_broken'

const ACTION_COPY: Record<PendingAction, { label: string; confirm: string }> = {
  verify: {
    label: '我已核实可用',
    confirm:
      '请实际打开链接核对后再确认。同一链接版本 30 天内只能核实一次，确认后链接回到正常。'
  },
  confirm_broken: {
    label: '确认失效',
    confirm: '确认后链接标记为已失效并从卡片折叠；之后仍可通过补链恢复。'
  }
}

const basisOf = (row: LinkHealthListRow): LinkHealthBasis => ({
  patchId: row.patchId,
  resourceId: row.resourceId,
  linkId: row.linkId,
  linkVersion: row.version,
  evidenceRound: row.evidenceRound,
  health: row.health,
  healthChangedAt: row.healthChangedAt
})

const resourceHref = (row: LinkHealthListRow) =>
  `/${row.patch.uniqueId}?tab=resources&resourceSection=${row.resource.section}&resourceId=${row.resourceId}`

/**
 * 「链接待修复」分组（模块 04，M04-5）：发布者在「待我处理」看到自己的非
 * ok 链接。动作完全由服务端 capabilities 驱动，每次写操作先确认再提交；
 * 具名 409 原样提示、不自动重试。补链通过既有资源编辑入口完成。
 */
export function IssueLinkRepairList({
  repair
}: {
  repair: UseLinkRepairListReturn
}) {
  const { list, loading, error, page, setPage, refresh } = repair
  const [pending, setPending] = useState<{
    row: LinkHealthListRow
    action: PendingAction
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const rows = list?.items ?? []
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1

  const handleConfirm = async () => {
    if (!pending) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<LinkHealthMutationResponse | string>(
        '/patch/resource/link/health',
        { ...basisOf(pending.row), action: pending.action }
      )
      if (typeof res === 'string') {
        toast.error(res || '操作失败，请稍后重试')
        return
      }
      toast.success('已提交')
      setPending(null)
      refresh()
    } catch {
      toast.error('网络错误，操作失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Wrench className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-medium">链接待修复</h2>
          {list && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {list.total}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={refresh}
        >
          刷新
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              重试
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            没有需要修复的链接，继续保持。
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.linkId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        row.health === 'disputed' ? 'destructive' : 'secondary'
                      }
                    >
                      {LINK_HEALTH_LABELS[row.health]}
                    </Badge>
                    <span className="truncate text-sm font-medium">
                      {row.resource.name || '资源备注'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.patch.name || row.patch.uniqueId} · {row.storage} ·{' '}
                      {row.size}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.healthChangedAt
                      ? `进入该状态：${formatChinaDateTime(row.healthChangedAt)}`
                      : '状态时间未知'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.capabilities.ownerActions.includes('verify') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPending({ row, action: 'verify' })}
                    >
                      {ACTION_COPY.verify.label}
                    </Button>
                  )}
                  {row.capabilities.ownerActions.includes('confirm_broken') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn('text-destructive')}
                      onClick={() =>
                        setPending({ row, action: 'confirm_broken' })
                      }
                    >
                      {ACTION_COPY.confirm_broken.label}
                    </Button>
                  )}
                  {row.capabilities.canEdit && (
                    <Button type="button" variant="ghost" size="sm" asChild>
                      <Link href={resourceHref(row)}>
                        <ExternalLink className="size-4" aria-hidden />
                        去补链
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1 text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="text-muted-foreground tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </CardContent>

      {/*
        受控 open：提交期间 onOpenChange(false) 一律忽略（ESC/遮罩/外部点击
        都关不掉），取消与关闭都保持零写入；成功/显式动作后再放 pending。
      */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? ACTION_COPY[pending.action].label : '确认操作'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `${pending.row.resource.name || '资源备注'}（${pending.row.storage}）——${ACTION_COPY[pending.action].confirm}`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                // Radix Action 默认同次点击关闭 Dialog：先拦截，按结果显式关
                event.preventDefault()
                void handleConfirm()
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
