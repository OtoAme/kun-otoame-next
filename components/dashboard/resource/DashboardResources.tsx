'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Loader2, Pencil, Trash2 } from 'lucide-react'

import {
  SearchableListPage,
  UserAvatar,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import { WorkspaceDiskKindBadge } from '~/components/dashboard/workspace/WorkspaceDiskKindBadge'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { LINK_HEALTH_LABELS } from '~/components/patch/resource/linkHealthDisplay'
import { RESOURCE_STATUS_MAP } from '~/constants/admin'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_LINK_MAP,
  SUPPORTED_TYPE_MAP
} from '~/constants/resource'
import { cn } from '~/lib/dashboard/utils'
import { kunFetchDelete } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { recognizeResourceDiskKind } from '~/utils/resourceDiskKind'
import type { AdminResource } from '~/types/api/admin'
import type { PatchResourceHealthEditData } from '~/types/api/patch'

// The list route returns health-projected links in place of the plain ones.
type ResourceRow = Omit<AdminResource, 'links'> & PatchResourceHealthEditData

const LIST_CONFIG = {
  endpoint: '/admin/resource',
  field: 'resources',
  fallbackError: '获取资源列表失败，请稍后重试'
}

const STATUS_CLASS: Record<number, string> = {
  0: 'border-green-600/40 text-green-700 dark:text-green-400',
  1: 'border-red-600/40 text-red-700 dark:text-red-400',
  2: 'border-amber-600/40 text-amber-700 dark:text-amber-400'
}
const HEALTH_CLASS: Record<string, string> = {
  ok: '',
  suspect: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  disputed: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  broken: 'border-red-600/40 text-red-700 dark:text-red-400'
}

const frontHref = (row: ResourceRow) =>
  `/${row.uniqueId}?resourceId=${row.id}&resourceSection=${row.section}`

function StatusBadge({ status }: { status: number }) {
  return (
    <Badge variant="outline" className={cn(STATUS_CLASS[status])}>
      {RESOURCE_STATUS_MAP[status] ?? `状态 ${status}`}
    </Badge>
  )
}

const label = (map: Record<string, string>, values: string[]) =>
  values.map((value) => map[value] ?? value).join('、') || '—'

/** Deletes resources one at a time; the API removes one resource per call. */
function ResourceDeleteDialog({
  ids,
  label: buttonLabel,
  onDeleted
}: {
  ids: number[]
  label: string
  onDeleted: (count: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const idsKey = ids.join(',')
  const shownKey = useRef(idsKey)

  // A changed target closes the dialog so it never confirms another set.
  useEffect(() => {
    if (shownKey.current === idsKey) return
    shownKey.current = idsKey
    if (!inflight.current) {
      setOpen(false)
      setError(null)
    }
  }, [idsKey])

  const confirm = async () => {
    if (inflight.current || ids.length === 0) return
    const targets = [...ids]
    inflight.current = true
    setBusy(true)
    setError(null)
    let deleted = 0
    const failures: string[] = []
    for (const resourceId of targets) {
      try {
        const res = await kunFetchDelete<Record<string, unknown> | string>(
          '/admin/resource',
          { resourceId }
        )
        if (typeof res === 'string') failures.push(`#${resourceId}：${res}`)
        else deleted += 1
      } catch {
        failures.push(`#${resourceId}：网络错误，结果未知`)
      }
    }
    inflight.current = false
    setBusy(false)
    if (deleted > 0) toast.success(`已删除 ${deleted} 份资源`)
    if (failures.length > 0) {
      // Keep the dialog open with each failure so nothing is silently lost.
      setError(`${failures.length} 份未删除：${failures.join('；')}`)
      if (deleted > 0) onDeleted(deleted)
      return
    }
    setOpen(false)
    onDeleted(deleted)
  }

  const count = ids.length
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (inflight.current) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={count === 0}>
          <Trash2 />
          {buttonLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? '删除资源' : `删除 ${count} 份资源`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? `即将删除资源 #${ids[0]}。`
              : `即将逐个删除已选择的 ${count} 份资源。`}
            资源的全部下载链接、对象存储里的文件和相关失效报告会一并处理，操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm break-words text-destructive"
          >
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '删除中…' : '删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const COLUMNS: ListColumn<ResourceRow>[] = [
  {
    key: 'name',
    header: '资源',
    grow: true,
    cell: (row) => (
      <span className="block min-w-0">
        <span className="line-clamp-1 font-medium break-words">
          {row.name || '未命名资源'}
        </span>
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {row.patchName}
        </span>
      </span>
    )
  },
  {
    key: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />
  },
  {
    key: 'section',
    header: '分区',
    minWidth: 560,
    cell: (row) => RESOURCE_SECTION_MAP[row.section] ?? row.section
  },
  {
    key: 'publisher',
    header: '发布者',
    minWidth: 640,
    cell: (row) => (
      <span className="flex items-center gap-2">
        <UserAvatar user={row.user} />
        <span className="max-w-28 truncate">{row.user.name}</span>
      </span>
    )
  },
  {
    key: 'links',
    header: '链接',
    minWidth: 800,
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        {row.links.map((link) => (
          <WorkspaceDiskKindBadge
            key={link.id}
            kind={recognizeResourceDiskKind(link.content, link.storage)}
          />
        ))}
      </span>
    )
  },
  {
    key: 'download',
    header: '下载',
    minWidth: 900,
    align: 'right',
    cell: (row) => row.download
  },
  {
    key: 'created',
    header: '发布时间',
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">
        {formatChinaDateTime(row.created)}
      </span>
    )
  }
]

function ResourceDetail({
  resource,
  onDeleted
}: {
  resource: ResourceRow
  onDeleted: (count: number) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold break-words">
          {resource.name || '未命名资源'}
        </h4>
        <StatusBadge status={resource.status} />
      </div>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">所属游戏</dt>
        <dd className="min-w-0 break-words">{resource.patchName}</dd>
        <dt className="text-muted-foreground">发布者</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <UserAvatar user={resource.user} />
          <Link
            href={`/user/${resource.user.id}`}
            prefetch={false}
            className="truncate underline-offset-4 hover:underline"
          >
            {resource.user.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">分区</dt>
        <dd>{RESOURCE_SECTION_MAP[resource.section] ?? resource.section}</dd>
        <dt className="text-muted-foreground">类型</dt>
        <dd>{label(SUPPORTED_TYPE_MAP, resource.type)}</dd>
        <dt className="text-muted-foreground">语言</dt>
        <dd>{label(SUPPORTED_LANGUAGE_MAP, resource.language)}</dd>
        <dt className="text-muted-foreground">平台</dt>
        <dd>{label(SUPPORTED_PLATFORM_MAP, resource.platform)}</dd>
        <dt className="text-muted-foreground">下载次数</dt>
        <dd className="tabular-nums">{resource.download}</dd>
        <dt className="text-muted-foreground">发布时间</dt>
        <dd className="tabular-nums">
          {formatChinaDateTime(resource.created)}
        </dd>
        <dt className="text-muted-foreground">资源 ID</dt>
        <dd className="tabular-nums">#{resource.id}</dd>
      </dl>
      {resource.note && (
        <div>
          <h5 className="mb-1 text-xs text-muted-foreground">备注</h5>
          <p className="max-w-[40em] text-sm leading-6 break-words whitespace-pre-wrap">
            {resource.note}
          </p>
        </div>
      )}
      <div>
        <h5 className="mb-2 text-xs text-muted-foreground">
          下载链接（{resource.links.length}）
        </h5>
        <ul className="flex flex-col gap-2">
          {resource.links.map((link) => (
            <li key={link.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <WorkspaceDiskKindBadge
                  kind={recognizeResourceDiskKind(link.content, link.storage)}
                />
                <span className="text-xs text-muted-foreground">
                  {SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage}
                  {link.size ? ` · ${link.size}` : ''}
                </span>
                <Badge
                  variant="outline"
                  className={cn('ml-auto', HEALTH_CLASS[link.health])}
                >
                  {LINK_HEALTH_LABELS[link.health] ?? link.health}
                </Badge>
              </div>
              <p className="mt-2 font-mono text-xs break-all">{link.content}</p>
              {(link.code || link.password) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {link.code && `提取码 ${link.code}`}
                  {link.code && link.password && ' · '}
                  {link.password && `解压码 ${link.password}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        编辑请到游戏页：页面会定位到这份资源，再点它的编辑按钮。链接改动按版本校验，不会覆盖他人同时的修改。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={frontHref(resource)} target="_blank" rel="noreferrer">
            <Pencil />
            到游戏页编辑
          </a>
        </Button>
        <ResourceDeleteDialog
          ids={[resource.id]}
          label="删除"
          onDeleted={onDeleted}
        />
      </div>
    </div>
  )
}

export function DashboardResources() {
  return (
    <SearchableListPage<ResourceRow>
      config={LIST_CONFIG}
      title="下载资源"
      description="按下载链接（或 BLAKE3 Hash）或发布者查找资源，列表按当前账号的内容显示设置过滤。删除会写入管理日志。"
      noun="资源"
      contentLabel="资源链接"
      columns={COLUMNS}
      card={(row) => ({
        text: row.name || '未命名资源',
        meta: `${RESOURCE_STATUS_MAP[row.status] ?? row.status} · ${row.patchName} · ${row.user.name}`
      })}
      detail={(row, actions) => (
        <ResourceDetail resource={row} onDeleted={actions.onDeleted} />
      )}
      batchDelete={({ ids, onDeleted }) => (
        <ResourceDeleteDialog
          ids={ids}
          label="批量删除"
          onDeleted={onDeleted}
        />
      )}
    />
  )
}
