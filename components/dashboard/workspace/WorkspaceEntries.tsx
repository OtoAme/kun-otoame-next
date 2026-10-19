'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import { Input } from '~/components/dashboard/ui/input'
import {
  PUBLISHED_ENTRY_CORRECTION_NOTICE,
  WORKSPACE_PAGE_LIMIT
} from '~/constants/workspace'
import { emptyPatchSubmissionPayload } from '~/store/patchSubmissionStore'
import type {
  PatchSubmissionQuota,
  PatchSubmissionStatus
} from '~/types/api/patchSubmission'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'
import type {
  WorkspaceEntriesResponse,
  WorkspaceEntry,
  WorkspaceEntryView
} from '~/types/api/workspace'
import { generateUUID } from '~/utils/random'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { useWorkspaceUser } from './WorkspaceShell'

const STATUS_LABEL: Record<PatchSubmissionStatus, string> = {
  draft: '编辑中',
  pending: '审核中',
  changes_requested: '需修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

const editableStatus = (status: PatchSubmissionStatus) =>
  status === 'draft' || status === 'changes_requested'

export function WorkspaceEntries() {
  const router = useRouter()
  const workspaceUser = useWorkspaceUser()
  const canEditPublished = workspaceUser.role >= 3
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
  const generationRef = useRef(0)

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
      setData(response)
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

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">我的条目</h1>
        <p className="text-sm text-muted-foreground">
          {canEditPublished
            ? '草稿和需修改的投稿可以继续编辑。已发布条目请打开对应条目页查看并编辑。'
            : '草稿和需修改的投稿可以继续编辑。已发布条目的修改申请暂未开放。'}
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
          className="flex min-w-0 flex-1 flex-wrap gap-2"
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
          <Button type="submit" size="sm" variant="outline">
            搜索
          </Button>
        </form>
        {view === 'submissions' ? (
          <label className="flex items-center gap-2 text-sm">
            状态
            <select
              aria-label="投稿状态"
              className="h-9 rounded-md border bg-background px-2"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PatchSubmissionStatus | 'all')
                setPage(1)
              }}
            >
              <option value="all">全部</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading && !data ? <p className="text-sm">正在加载条目…</p> : null}
      <ul className="grid min-w-0 gap-3">
        {(data?.items ?? []).map((item) => (
          <li key={entryKey(item)} className="min-w-0">
            <EntryCard
              item={item}
              canEditPublished={canEditPublished}
              withdrawing={
                item.kind === 'submission' &&
                withdrawingId === item.submission.id
              }
              onWithdraw={(id) => void withdraw(id)}
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
  canEditPublished,
  withdrawing,
  onWithdraw
}: {
  item: WorkspaceEntry
  canEditPublished: boolean
  withdrawing: boolean
  onWithdraw: (id: number) => void
}) {
  if (item.kind === 'published') {
    return (
      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 truncate font-medium">{item.patch.name}</h2>
            <Badge variant="secondary">已发布</Badge>
          </div>
          {canEditPublished ? null : (
            <p className="text-sm text-muted-foreground">
              {PUBLISHED_ENTRY_CORRECTION_NOTICE}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/${item.patch.uniqueId}`}>查看</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${item.patch.uniqueId}`}>反馈</Link>
            </Button>
            {canEditPublished ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/${item.patch.uniqueId}`}>在条目页查看并编辑</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    )
  }

  const submission = item.submission
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
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
          ) : null}
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
