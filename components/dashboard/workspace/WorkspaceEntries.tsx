'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '~/components/dashboard/ui/dropdown-menu'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import {
  PUBLISHED_ENTRY_CORRECTION_NOTICE,
  WORKSPACE_PAGE_LIMIT
} from '~/constants/workspace'
import { emptyPatchSubmissionPayload } from '~/store/patchSubmissionStore'
import type {
  PatchSubmissionQuota,
  PatchSubmissionStatus,
  PatchSubmissionSummary
} from '~/types/api/patchSubmission'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'
import type {
  WorkspaceEntriesResponse,
  WorkspaceEntry,
  WorkspaceEntryView
} from '~/types/api/workspace'
import { generateUUID } from '~/utils/random'
import {
  kunFetchDelete,
  kunFetchGet,
  kunFetchPost,
  kunFetchPatch
} from '~/utils/kunFetch'
import { clearPatchSubmissionDraftStorage } from '~/utils/patchSubmissionUploadDraft'
import { useWorkspaceUser } from './WorkspaceShell'
import { WorkspaceBanner } from './WorkspaceBanner'

const STATUS_LABEL: Record<PatchSubmissionStatus, string> = {
  draft: '编辑中',
  pending: '审核中',
  changes_requested: '需修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

/** The author's own list never filters to terminal published/deleted states. */
const FILTERABLE_STATUS: PatchSubmissionStatus[] = [
  'draft',
  'pending',
  'changes_requested',
  'rejected',
  'violation'
]

const editableStatus = (status: PatchSubmissionStatus) =>
  status === 'draft' || status === 'changes_requested'

const hidableStatus = (status: PatchSubmissionStatus) =>
  status === 'rejected' || status === 'violation'

export function WorkspaceEntries() {
  const router = useRouter()
  const workspaceUser = useWorkspaceUser()
  const isOrdinaryAuthor = workspaceUser.role < 3
  const [view, setView] = useState<WorkspaceEntryView>('submissions')
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [status, setStatus] = useState<PatchSubmissionStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<WorkspaceEntriesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] =
    useState<PatchSubmissionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<number>>(new Set())
  const generationRef = useRef(0)
  /** Deleted ids stay deleted even if a stale refresh resolves later. */
  const deletedIdsRef = useRef(new Set<number>())

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    try {
      const response = await kunFetchGet<WorkspaceEntriesResponse | string>(
        '/workspace/entries',
        {
          view,
          page,
          limit: WORKSPACE_PAGE_LIMIT,
          ...(submittedQuery ? { query: submittedQuery } : {}),
          ...(view === 'submissions' && status !== 'all' ? { status } : {})
        }
      )
      if (generation !== generationRef.current) return
      if (typeof response === 'string') {
        setError(response || '加载条目失败')
        return
      }
      setData((current) => {
        const staleDeletedRead = response.items.some(
          (item) =>
            item.kind === 'submission' &&
            deletedIdsRef.current.has(item.submission.id)
        )
        // A snapshot that still contains a deleted id is from before the
        // delete committed. Keep the card gone and keep the balance already
        // shown; a later read that no longer contains the id can refresh both.
        if (current && staleDeletedRead) return current
        return {
          ...response,
          items: response.items.filter(
            (item) =>
              item.kind !== 'submission' ||
              !deletedIdsRef.current.has(item.submission.id)
          )
        }
      })
    } catch {
      if (generation !== generationRef.current) return
      setError('网络错误，列表加载失败，请重试')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [page, status, submittedQuery, view])

  useEffect(() => {
    void load()
  }, [load])

  const createDraft = async () => {
    if (!data?.quota) return
    setCreating(true)
    try {
      const response = await kunFetchPost<string | { submissionId: number }>(
        '/patch-submission',
        {
          requestId: generateUUID().replace(/-/g, ''),
          payload: { ...emptyPatchSubmissionPayload, name: '未命名投稿' }
        }
      )
      if (typeof response === 'string') {
        setError(response)
        return
      }
      router.push(`/submission/${response.submissionId}`)
    } catch {
      setError('新建投稿失败，请检查网络后重试')
    } finally {
      setCreating(false)
    }
  }

  const withdraw = async (id: number) => {
    setWithdrawingId(id)
    try {
      const response = await kunFetchPost<string | Record<string, never>>(
        `/patch-submission/${id}/withdraw`
      )
      if (typeof response === 'string') {
        setError(response)
        return
      }
      await load()
    } catch {
      setError('撤回失败，请稍后重试')
    } finally {
      setWithdrawingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    setDeleting(true)
    setDeleteError('')
    try {
      const response = await kunFetchDelete<
        string | { moemoepointBalance: MoemoepointBalance | null }
      >(`/patch-submission/${target.id}`)
      if (typeof response === 'string') {
        setDeleteError(response)
        return
      }
      deletedIdsRef.current.add(target.id)
      // The server cannot reach this browser's localforage, so the draft's
      // pending uploads and options are only clearable from here.
      await clearPatchSubmissionDraftStorage(target.id).catch(() => {})
      setData((current) =>
        current
          ? {
              ...current,
              total: Math.max(0, current.total - 1),
              moemoepointBalance:
                response.moemoepointBalance ?? current.moemoepointBalance,
              quota: current.quota
                ? {
                    ...current.quota,
                    activeCount: Math.max(0, current.quota.activeCount - 1)
                  }
                : null,
              items: current.items.filter(
                (item) =>
                  item.kind !== 'submission' || item.submission.id !== target.id
              )
            }
          : current
      )
      setPendingDelete(null)
      // Refresh quota/balance in the background; a failure here must not bring
      // the deleted card back because deletedIdsRef filters it out.
      void load()
    } catch {
      setDeleteError('删除失败，请检查网络后重试')
    } finally {
      setDeleting(false)
    }
  }

  const hide = async (id: number) => {
    try {
      const response = await kunFetchPatch<string | Record<string, never>>(
        `/patch-submission/${id}`,
        {}
      )
      if (typeof response === 'string') {
        setError(response)
        return
      }
      // Hiding is list-only: no deposit moves and the browser draft stays.
      setHiddenIds((current) => new Set(current).add(id))
    } catch {
      setError('隐藏失败，请稍后重试')
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">我的条目</h1>
        <p className="text-sm text-muted-foreground">
          草稿和需修改的投稿可以继续编辑。已发布条目请打开对应条目页查看。
        </p>
      </div>
      <QuotaBar
        quota={data?.quota ?? null}
        balance={data?.moemoepointBalance ?? null}
        canCreateDirect={Boolean(data?.canCreateDirect)}
        creating={creating}
        onCreate={() => void createDraft()}
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={view === 'submissions' ? 'default' : 'outline'}
            onClick={() => {
              setView('submissions')
              setPage(1)
            }}
          >
            投稿
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'published' ? 'default' : 'outline'}
            onClick={() => {
              setView('published')
              setStatus('all')
              setPage(1)
            }}
          >
            已发布
          </Button>
        </div>
        <form
          className="flex w-full min-w-0 shrink-0 flex-wrap gap-2 sm:w-auto sm:flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            setPage(1)
            setSubmittedQuery(query.trim())
          }}
        >
          <Input
            aria-label="搜索条目"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1"
            placeholder="搜索名称"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="shrink-0"
          >
            搜索
          </Button>
        </form>
        {view === 'submissions' ? (
          <div className="flex items-center gap-2 text-sm">
            <span>状态</span>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as PatchSubmissionStatus | 'all')
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="投稿状态" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {FILTERABLE_STATUS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading && !data ? <p className="text-sm">正在加载条目…</p> : null}
      {view === 'published' && isOrdinaryAuthor && data ? (
        <p className="text-sm text-muted-foreground">
          {PUBLISHED_ENTRY_CORRECTION_NOTICE}
        </p>
      ) : null}
      <ul className="grid min-w-0 gap-3">
        {(data?.items ?? [])
          .filter(
            (item) =>
              item.kind !== 'submission' || !hiddenIds.has(item.submission.id)
          )
          .map((item) => (
            <li key={entryKey(item)} className="min-w-0">
              <EntryCard
                item={item}
                withdrawing={
                  item.kind === 'submission' &&
                  withdrawingId === item.submission.id
                }
                onWithdraw={(id) => void withdraw(id)}
                onDelete={(submission) => {
                  setDeleteError('')
                  setPendingDelete(submission)
                }}
                onHide={(id) => void hide(id)}
              />
            </li>
          ))}
      </ul>
      {data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有符合条件的条目。</p>
      ) : null}
      <Pager
        page={data?.page ?? page}
        total={data?.total ?? 0}
        limit={data?.limit ?? WORKSPACE_PAGE_LIMIT}
        onPage={setPage}
      />
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除投稿</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除《{pendingDelete?.name || '未命名投稿'}
              》吗？删除后草稿不可恢复
              {pendingDelete?.heldAmount
                ? `，暂扣的 ${pendingDelete.heldAmount} 萌萌点会返还`
                : ''}
              。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? '正在删除…' : '删除并返还'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function entryKey(item: WorkspaceEntry) {
  return item.kind === 'submission'
    ? `submission-${item.submission.id}`
    : `patch-${item.patch.id}`
}

function QuotaBar({
  quota,
  balance,
  canCreateDirect,
  creating,
  onCreate
}: {
  quota: PatchSubmissionQuota | null
  balance: MoemoepointBalance | null
  canCreateDirect: boolean
  creating: boolean
  onCreate: () => void
}) {
  if (canCreateDirect) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>直接创建条目</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            管理员可以直接创建游戏条目，不走投稿暂扣。条目页上的原有改写入口保持不变。
          </p>
          <Button asChild>
            <Link href="/edit/create">新建条目</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!quota || !balance) return null
  const canCreate =
    quota.activeCount < quota.maxActive &&
    balance.available >= quota.depositAmount
  return (
    <Card>
      <CardHeader>
        <CardTitle>投稿额度</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">
          进行中 {quota.activeCount} / {quota.maxActive}
        </Badge>
        <Badge variant="secondary">可用萌萌点 {balance.available}</Badge>
        <Badge variant="secondary">暂扣中 {balance.reserved}</Badge>
        <span className="text-muted-foreground">
          新建暂扣 {quota.depositAmount} 萌萌点
        </span>
        <Button
          type="button"
          disabled={!canCreate || creating}
          onClick={onCreate}
        >
          {creating ? '正在创建…' : '新建投稿'}
        </Button>
      </CardContent>
    </Card>
  )
}

function EntryCard({
  item,
  withdrawing,
  onWithdraw,
  onDelete,
  onHide
}: {
  item: WorkspaceEntry
  withdrawing: boolean
  onWithdraw: (id: number) => void
  onDelete: (submission: PatchSubmissionSummary) => void
  onHide: (id: number) => void
}) {
  if (item.kind === 'published') {
    return (
      <Card>
        <CardContent className="flex min-w-0 flex-col gap-3 pt-4 sm:flex-row">
          <WorkspaceBanner
            banner={item.patch.banner}
            alt={item.patch.name}
            className="h-32 w-full shrink-0 rounded-md object-cover sm:w-40"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h2 className="min-w-0 truncate font-medium">
                {item.patch.name}
              </h2>
              <Badge variant="secondary">已发布</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/${item.patch.uniqueId}`}>查看条目</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const submission = item.submission
  return (
    <Card>
      <CardContent className="flex min-w-0 flex-col gap-3 pt-4 sm:flex-row">
        <WorkspaceBanner
          banner={submission.bannerUrl ?? ''}
          alt={submission.name || '未命名投稿'}
          className="h-32 w-full shrink-0 rounded-md object-cover sm:w-40"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 break-all font-medium">
              {submission.name || '未命名投稿'}
            </h2>
            <Badge variant="secondary">{STATUS_LABEL[submission.status]}</Badge>
          </div>
          {submission.reviewReason ? (
            <p className="text-sm text-muted-foreground">
              {submission.reviewReason}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {editableStatus(submission.status) ? (
              <Button asChild size="sm">
                <Link href={`/submission/${submission.id}`}>继续编辑</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href={`/submission/${submission.id}`}>查看</Link>
              </Button>
            )}
            {submission.status === 'pending' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={withdrawing}
                onClick={() => onWithdraw(submission.id)}
              >
                {withdrawing ? '正在撤回…' : '撤回'}
              </Button>
            ) : null}
            {editableStatus(submission.status) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`投稿 ${submission.name || submission.id} 的更多操作`}
                  >
                    更多
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onDelete(submission)}>
                    删除并返还
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {hidableStatus(submission.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onHide(submission.id)}
              >
                从列表隐藏
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Pager({
  page,
  total,
  limit,
  onPage
}: {
  page: number
  total: number
  limit: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / limit))
  if (pages <= 1) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </Button>
      <span className="text-sm text-muted-foreground">
        {page} / {pages}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </Button>
    </div>
  )
}
