'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SearchableListPage,
  type FilterChip,
  type FilterContext,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '~/components/dashboard/ui/dialog'
import { Label } from '~/components/dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Tabs, TabsList, TabsTrigger } from '~/components/dashboard/ui/tabs'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { ResourceEditForm } from '~/components/dashboard/inbox/ResourceEditForm'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_RESOURCE_LINK_MAP
} from '~/constants/resource'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { formatBackupDate } from '~/components/patch/resource/publicMirrorFacts'
import type { AdminResource } from '~/types/api/admin'
import type {
  BackupMutationResult,
  OfficialMirrorCacheRefresh
} from '~/types/api/officialMirror'
import { cacheRefreshBody } from './cacheRefresh'
import {
  acceptBackupListRow,
  BACKUP_TABS,
  IGNORE_REASON_MAX,
  isBackupBasis,
  notifyOfficialMirrorQueue,
  subscribeOfficialMirrorQueue,
  type BackupDetail,
  type BackupListResponse,
  type BackupListRow,
  type BackupTab
} from './contract'

const TAB_LABEL: Record<BackupTab, string> = {
  unbacked: '未备份',
  rebackup: '待重新备份',
  ignored: '已忽略'
}

const oneOf =
  (allowed: readonly string[]) =>
  (raw: string): string | null =>
    allowed.includes(raw) ? raw : null

const BACKUP_LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/backup',
  field: 'items',
  fallbackError: '获取站方备份队列失败，请稍后重试',
  acceptRow: acceptBackupListRow,
  filters: {
    tab: oneOf(BACKUP_TABS),
    section: oneOf(['galgame', 'patch']),
    sort: oneOf(['download_desc', 'download_asc'])
  },
  defaultParams: { tab: 'unbacked', sort: 'download_desc' }
}

const showTime = (value: string | null) => {
  if (!value) return '—'
  return formatBackupDate(value) ?? '—'
}

const COLUMNS: ListColumn<BackupListRow>[] = [
  {
    key: 'game',
    header: '游戏',
    grow: true,
    cell: (row) => row.patchName || '—'
  },
  {
    key: 'name',
    header: '卡片',
    minWidth: 720,
    cell: (row) => row.name || '未命名资源'
  },
  {
    key: 'publisher',
    header: '发布者',
    minWidth: 900,
    cell: (row) => row.publisher.name || '—'
  },
  {
    key: 'download',
    header: '获取次数',
    minWidth: 1080,
    align: 'right',
    cell: (row) => row.download
  },
  {
    key: 'changed',
    header: '外部链接变动',
    minWidth: 1200,
    cell: (row) => showTime(row.latestExternalChangeAt)
  }
]

function BackupToolbar({ filters, setFilters }: FilterContext) {
  const [counts, setCounts] = useState<Record<BackupTab, number> | null>(null)
  const tab = (filters.tab as BackupTab | undefined) ?? 'unbacked'
  useEffect(() => {
    let active = true
    const load = () => {
      const params: Record<string, string | number> = {
        page: 1,
        limit: 1,
        tab: 'unbacked'
      }
      if (filters.section) params.section = filters.section
      void kunFetchGet<BackupListResponse | string>('/admin/backup', params)
        .then((body) => {
          if (!active || typeof body === 'string' || !body.counts) return
          setCounts(body.counts)
        })
        .catch(() => {
          if (active) setCounts(null)
        })
    }
    load()
    const unsubscribe = subscribeOfficialMirrorQueue(() => {
      if (active) load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [filters.section])
  return (
    <Tabs
      value={tab}
      onValueChange={(value) =>
        setFilters({ tab: value === 'unbacked' ? '' : value })
      }
    >
      <TabsList>
        {BACKUP_TABS.map((item) => (
          <TabsTrigger key={item} value={item}>
            {TAB_LABEL[item]}
            {counts ? ` ${counts[item]}` : ''}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

type BackupCacheResult = {
  resourceId: number
  changed: boolean
  cacheRefreshed: boolean
  retry: ReturnType<typeof cacheRefreshBody>
  pending: boolean
  error: string
}

function BackupDetail({
  row,
  reviewer,
  onChanged,
  onSettled
}: {
  row: BackupListRow
  reviewer: { id: number; role: number }
  onChanged: () => void
  onSettled: (result: {
    resourceId: number
    changed: boolean
    cacheRefreshed: boolean
    retry: ReturnType<typeof cacheRefreshBody>
  }) => void
}) {
  const [detail, setDetail] = useState<BackupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<
    'ignore' | 'unignore' | 'dismiss' | null
  >(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<AdminResource | null>(null)
  const [opening, setOpening] = useState(false)
  const live = useRef({ seq: 0, resourceId: row.resourceId })

  const stillCurrent = (request: { seq: number; resourceId: number }) =>
    live.current.seq === request.seq &&
    live.current.resourceId === request.resourceId

  useEffect(() => {
    const seq = live.current.seq + 1
    const request = { seq, resourceId: row.resourceId }
    live.current = request
    setLoading(true)
    setDetail(null)
    setError('')
    setConfirm(null)
    setReason('')
    setEditor(null)
    setOpening(false)
    void kunFetchGet<BackupDetail | string>('/admin/backup/detail', {
      resourceId: row.resourceId
    })
      .then((body) => {
        if (!stillCurrent(request)) return
        if (typeof body === 'string') {
          setError(body || '读取备份详情失败，请稍后重试')
          return
        }
        if (body.resourceId !== request.resourceId) {
          setError('备份详情无法读取，请刷新')
          return
        }
        setDetail(body)
      })
      .catch(() => {
        if (stillCurrent(request)) setError('网络错误，请稍后重试')
      })
      .finally(() => {
        if (stillCurrent(request)) setLoading(false)
      })
    return () => {
      if (live.current.seq === request.seq) {
        live.current = { seq: request.seq + 1, resourceId: request.resourceId }
      }
    }
  }, [row.resourceId])

  const finish = async (
    path:
      | '/admin/backup/ignore'
      | '/admin/backup/unignore'
      | '/admin/backup/dismiss',
    body: { resourceId: number; reason?: string; basis?: string }
  ) => {
    if (!detail || detail.resourceId !== row.resourceId) return
    const request = {
      seq: live.current.seq,
      resourceId: detail.resourceId,
      patchUniqueId: detail.patchUniqueId,
      authorId: detail.publisher.id
    }
    setPending(true)
    setError('')
    try {
      const response = await kunFetchPost<BackupMutationResult | string>(
        path,
        body
      )
      if (typeof response === 'string') {
        if (stillCurrent(request)) setError(response || '操作失败，请稍后重试')
        return
      }
      if (
        response.resourceId !== request.resourceId ||
        typeof response.changed !== 'boolean' ||
        typeof response.cacheRefreshed !== 'boolean'
      ) {
        if (stillCurrent(request)) {
          setError('没有确认这次操作是否已经写入，请刷新核对后再操作')
        }
        return
      }
      const retry = response.cacheRefreshed
        ? null
        : cacheRefreshBody({
            patchUniqueId: request.patchUniqueId,
            authorId: request.authorId
          })
      notifyOfficialMirrorQueue()
      if (!stillCurrent(request)) return
      setConfirm(null)
      setReason('')
      onSettled({
        resourceId: request.resourceId,
        changed: response.changed,
        cacheRefreshed: response.cacheRefreshed,
        retry
      })
      onChanged()
    } catch {
      if (stillCurrent(request)) setError('网络错误，请稍后重试')
    } finally {
      if (stillCurrent(request)) setPending(false)
    }
  }

  const openEditor = async () => {
    const request = { seq: live.current.seq, resourceId: row.resourceId }
    setOpening(true)
    setError('')
    try {
      const response = await kunFetchGet<
        { resources?: AdminResource[] } | string
      >('/admin/resource', {
        resourceId: request.resourceId,
        page: 1,
        limit: 1
      })
      if (!stillCurrent(request)) return
      const resource =
        typeof response === 'string' ? null : response.resources?.[0]
      if (
        !resource ||
        resource.id !== request.resourceId ||
        !resource.baseLinks
      ) {
        setError(
          typeof response === 'string'
            ? response
            : '没有读到可编辑的资源，请刷新后再添加备份'
        )
        return
      }
      setEditor(resource)
    } catch {
      if (stillCurrent(request)) setError('网络错误，没有打开编辑')
    } finally {
      if (stillCurrent(request)) setOpening(false)
    }
  }

  const basisReady = detail ? isBackupBasis(detail.basis) : false
  // The merge workbench opens a user card by id, on any list page.
  const candidateHref = `/dashboard/resource-merges?id=${row.resourceId}`
  const consequence =
    confirm === 'ignore'
      ? '忽略后，这张卡片保持不备份。发布者之后更换链接也不会回到未备份，直到撤销忽略。'
      : confirm === 'unignore'
        ? '撤销忽略后，这张卡片按当前链接进入未备份或待重新备份。'
        : '确认后，已查看的外部链接变动不再要求重新备份。更晚的链接变动仍会让这张卡片出现。'

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <h4 className="break-words text-base font-semibold">
          {row.name || '未命名资源'}
        </h4>
        <p className="break-words text-sm text-muted-foreground">
          {row.patchName || '—'} · {row.publisher.name || '—'} · 获取次数{' '}
          {row.download}
        </p>
        <p className="text-sm text-muted-foreground">
          外部链接 {row.externalLinkCount} · 最近变动{' '}
          {showTime(row.latestExternalChangeAt)}
        </p>
        {row.tab === 'unbacked' ? (
          <Link
            href={candidateHref}
            className="text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            核对合并候选
          </Link>
        ) : null}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取详情…</p>
      ) : null}
      {detail?.note ? (
        <p className="max-w-[40em] text-sm leading-6 break-words whitespace-pre-wrap">
          {detail.note}
        </p>
      ) : null}
      {detail?.ignore?.reason ? (
        <p className="text-sm break-words">忽略理由：{detail.ignore.reason}</p>
      ) : null}
      {detail ? (
        <ul className="flex flex-col gap-2">
          {detail.links.map((link) => (
            <li key={link.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage}
                </span>
                {link.storage === 'touchgal' ? (
                  <Badge variant="outline">站方备份</Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {link.size ? `${link.size} · ` : ''}
                  {link.storage === 'touchgal'
                    ? `备份日期 ${showTime(link.backedUpAt)}`
                    : `变动 ${showTime(link.changedAt)}`}
                </span>
              </div>
              {link.content ? (
                <p className="mt-2 font-mono text-xs break-all">
                  {link.content}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error && confirm === null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {detail ? (
        <div className="flex flex-wrap gap-2">
          {row.tab === 'unbacked' ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError('')
                setConfirm('ignore')
              }}
            >
              忽略
            </Button>
          ) : null}
          {row.tab === 'ignored' ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError('')
                setConfirm('unignore')
              }}
            >
              撤销忽略
            </Button>
          ) : null}
          {row.tab === 'rebackup' ? (
            <Button
              type="button"
              variant="outline"
              disabled={!basisReady}
              onClick={() => {
                setError('')
                setConfirm('dismiss')
              }}
            >
              无需重新备份
            </Button>
          ) : null}
          {row.tab !== 'ignored' ? (
            <Button
              type="button"
              disabled={opening}
              onClick={() => void openEditor()}
            >
              {opening ? '正在打开…' : '去添加备份'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail && row.tab === 'rebackup' && !basisReady ? (
        <p role="status" className="text-sm text-muted-foreground">
          核对基点无效，请刷新后再确认。
        </p>
      ) : null}
      {confirm === 'ignore' && detail ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`backup-ignore-${detail.resourceId}`}>忽略理由</Label>
          <Textarea
            id={`backup-ignore-${detail.resourceId}`}
            value={reason}
            maxLength={IGNORE_REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}
      <ConfirmActionDialog
        open={confirm !== null}
        title={
          confirm === 'ignore'
            ? '忽略'
            : confirm === 'unignore'
              ? '撤销忽略'
              : '无需重新备份'
        }
        consequence={consequence}
        confirmLabel={
          confirm === 'ignore'
            ? '忽略'
            : confirm === 'unignore'
              ? '撤销忽略'
              : '无需重新备份'
        }
        pending={pending}
        error={error}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setConfirm(null)
            setError('')
          }
        }}
        onConfirm={() => {
          if (!detail || pending) return
          if (confirm === 'ignore') {
            const trimmed = reason.trim()
            void finish('/admin/backup/ignore', {
              resourceId: detail.resourceId,
              ...(trimmed ? { reason: trimmed } : {})
            })
          } else if (confirm === 'unignore') {
            void finish('/admin/backup/unignore', {
              resourceId: detail.resourceId
            })
          } else if (confirm === 'dismiss' && isBackupBasis(detail.basis)) {
            void finish('/admin/backup/dismiss', {
              resourceId: detail.resourceId,
              basis: detail.basis
            })
          }
        }}
      />
      <Dialog open={editor !== null} onOpenChange={() => undefined}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>添加站方备份</DialogTitle>
          </DialogHeader>
          {editor ? (
            <ResourceEditForm
              resource={editor}
              reviewerId={reviewer.id}
              reviewerRole={reviewer.role}
              successMessage="已保存。发布者会收到修改通知。"
              onCancel={() => setEditor(null)}
              onSaved={() => {
                setEditor(null)
                notifyOfficialMirrorQueue()
                onChanged()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BackupFilters({ filters, setFilters }: FilterContext) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="backup-section">分区</Label>
        <Select
          value={filters.section ?? 'all'}
          onValueChange={(value) =>
            setFilters({ section: value === 'all' ? '' : value })
          }
        >
          <SelectTrigger id="backup-section" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分区</SelectItem>
            {Object.entries(RESOURCE_SECTION_MAP).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="backup-sort">排序</Label>
        <Select
          value={filters.sort ?? 'download_desc'}
          onValueChange={(value) =>
            setFilters({ sort: value === 'download_desc' ? '' : value })
          }
        >
          <SelectTrigger id="backup-sort" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="download_desc">获取次数从高到低</SelectItem>
            <SelectItem value="download_asc">获取次数从低到高</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

const chips = (filters: FilterContext['filters']): FilterChip[] => {
  const items: FilterChip[] = []
  if (filters.section) {
    items.push({
      key: 'section',
      label: RESOURCE_SECTION_MAP[filters.section] ?? filters.section
    })
  }
  if (filters.sort === 'download_asc') {
    items.push({ key: 'sort', label: '获取次数从低到高' })
  }
  return items
}

function BackupSubmittedResult({
  result,
  onRetry
}: {
  result: BackupCacheResult
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-1">
      <p role="status" className="text-sm">
        {result.changed ? '已保存' : '没有写入变更'}
        {result.cacheRefreshed ? '，页面缓存已刷新。' : '，页面缓存没有刷新。'}
      </p>
      {result.cacheRefreshed ? null : result.retry ? (
        <Button
          type="button"
          variant="outline"
          disabled={result.pending}
          onClick={onRetry}
        >
          {result.pending ? '正在刷新缓存…' : '仅刷新缓存'}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          没有可用的页面标识，不能刷新缓存。
        </p>
      )}
      {result.error ? (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      ) : null}
    </div>
  )
}

export function DashboardBackup({
  reviewer
}: {
  reviewer: { id: number; role: number }
}) {
  const [result, setResult] = useState<BackupCacheResult | null>(null)

  const retryCache = async () => {
    if (!result?.retry || result.pending) return
    const resourceId = result.resourceId
    const body = result.retry
    setResult((current) =>
      current && current.resourceId === resourceId
        ? { ...current, pending: true, error: '' }
        : current
    )
    try {
      const response = await kunFetchPost<OfficialMirrorCacheRefresh | string>(
        '/admin/backup/refresh-cache',
        body
      )
      setResult((current) => {
        if (!current || current.resourceId !== resourceId) return current
        if (typeof response === 'string') {
          return {
            ...current,
            pending: false,
            error: response || '刷新缓存失败，请稍后重试'
          }
        }
        if (
          response.cacheRefreshed !== true ||
          response.uniqueIds[0] !== body.uniqueIds[0]
        ) {
          return { ...current, pending: false, error: '页面缓存仍未刷新' }
        }
        return {
          ...current,
          pending: false,
          cacheRefreshed: true,
          retry: null,
          error: ''
        }
      })
    } catch {
      setResult((current) =>
        current && current.resourceId === resourceId
          ? { ...current, pending: false, error: '网络错误，缓存没有刷新' }
          : current
      )
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {result ? (
        <BackupSubmittedResult
          result={result}
          onRetry={() => void retryCache()}
        />
      ) : null}
      <SearchableListPage<BackupListRow>
        config={BACKUP_LIST_CONFIG}
        title="站方备份"
        noun="资源"
        contentLabel="游戏或资源"
        searchByUser={false}
        columns={COLUMNS}
        toolbar={(ctx) => <BackupToolbar {...ctx} />}
        filterPanel={(ctx) => <BackupFilters {...ctx} />}
        filterChips={chips}
        card={(row) => ({
          text: row.name || '未命名资源',
          meta: `${row.patchName || '—'} · ${row.publisher.name || '—'} · 获取次数 ${row.download}`
        })}
        detail={(row, actions) => (
          <BackupDetail
            key={row.resourceId}
            row={row}
            reviewer={reviewer}
            onChanged={actions.onUpdated}
            onSettled={(settled) =>
              setResult({ ...settled, pending: false, error: '' })
            }
          />
        )}
      />
    </div>
  )
}
