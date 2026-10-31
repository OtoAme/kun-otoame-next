'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Check, Loader2, X } from 'lucide-react'

import { useDashboard } from '~/components/dashboard/DashboardShell'
import {
  SearchableListPage,
  UserAvatar,
  type FilterContext,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { APPLICANT_STATUS_MAP } from '~/constants/admin'
import { cn } from '~/lib/dashboard/utils'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'
import { kunFetchPut } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminCreator } from '~/types/api/admin'

const STATUS_FILTER_LABELS: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  declined: '已拒绝',
  all: '全部'
}

const LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/creator',
  field: 'creators',
  fallbackError: '获取创作者申请失败，请稍后重试',
  filters: {
    status: (raw) => (raw in STATUS_FILTER_LABELS ? raw : null)
  }
}

const STATUS_CLASS: Record<number, string> = {
  0: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  1: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  2: 'border-green-600/40 text-green-700 dark:text-green-400',
  3: 'border-red-600/40 text-red-700 dark:text-red-400'
}
const isOpen = (status: number) => status === 0 || status === 1

function StatusBadge({ status }: { status: number }) {
  return (
    <Badge variant="outline" className={cn(STATUS_CLASS[status])}>
      {isOpen(status) ? '待处理' : (APPLICANT_STATUS_MAP[status] ?? status)}
    </Badge>
  )
}

function StatusSelect({ filters, setFilters }: FilterContext) {
  return (
    <Select
      value={filters.status ?? 'pending'}
      onValueChange={(status) =>
        setFilters({ status: status === 'pending' ? '' : status })
      }
    >
      <SelectTrigger className="w-[120px] shrink-0" aria-label="申请状态">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(STATUS_FILTER_LABELS).map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Approve and decline both need confirmation. The server claims the
 * application atomically, so a repeated or concurrent review returns a
 * message instead of a second role change or notice.
 */
function ReviewDialog({
  creator,
  action,
  onDone
}: {
  creator: AdminCreator
  action: 'approve' | 'decline'
  onDone: () => void
}) {
  const { refreshCounts } = useDashboard()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const approve = action === 'approve'
  const sender = creator.sender

  const confirm = async () => {
    if (inflight.current || !sender) return
    if (!approve && !reason.trim()) {
      setError('请填写拒绝原因，申请人会在通知里看到它')
      return
    }
    inflight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await kunFetchPut<Record<string, unknown> | string>(
        approve ? '/admin/creator/approve' : '/admin/creator/decline',
        approve
          ? { messageId: creator.id, uid: sender.id }
          : { messageId: creator.id, reason: reason.trim() }
      )
      if (typeof res === 'string') {
        setError(res || '操作失败，请稍后重试')
        return
      }
      toast.success(approve ? '已通过创作者申请' : '已拒绝创作者申请')
      setOpen(false)
      setReason('')
      onDone()
      void refreshCounts()
    } catch {
      setError('网络错误，结果未知。请刷新列表核对后再决定是否重试。')
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }

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
        <Button
          size="sm"
          variant={approve ? 'default' : 'outline'}
          disabled={!sender}
        >
          {approve ? <Check /> : <X />}
          {approve ? '通过' : '拒绝'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {approve ? '通过创作者申请' : '拒绝创作者申请'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {approve
              ? `通过后 ${sender?.name} 成为创作者，发布资源不再需要审核，并收到系统通知。已是创作者或更高身份的账号不会被改动。`
              : `${sender?.name} 会收到带拒绝原因的系统通知，账号身份不变，之后可以重新申请。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!approve && (
          <Textarea
            aria-label="拒绝原因"
            placeholder="例如：已发布的资源较少，建议继续发布后再申请"
            value={reason}
            maxLength={1007}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-24"
          />
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <Button
            variant={approve ? 'default' : 'destructive'}
            disabled={busy}
            onClick={confirm}
          >
            {busy && <Loader2 className="animate-spin" />}
            {approve ? '确认通过' : '确认拒绝'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const COLUMNS: ListColumn<AdminCreator>[] = [
  {
    key: 'applicant',
    header: '申请人',
    cell: (row) =>
      row.sender ? (
        <span className="flex items-center gap-2">
          <UserAvatar user={row.sender} />
          <span className="max-w-28 truncate font-medium">
            {row.sender.name}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">已注销</span>
      )
  },
  {
    key: 'resources',
    header: '已发布资源',
    align: 'right',
    cell: (row) => row.patchResourceCount
  },
  {
    key: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />
  },
  {
    key: 'created',
    header: '申请时间',
    minWidth: 760,
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">
        {formatChinaDateTime(row.created)}
      </span>
    )
  }
]

function CreatorDetail({
  creator,
  onDone
}: {
  creator: AdminCreator
  onDone: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {creator.sender && (
        <div className="flex items-center gap-3">
          <UserAvatar user={creator.sender} />
          <div className="min-w-0">
            <Link
              href={`/user/${creator.sender.id}`}
              prefetch={false}
              className="font-medium underline-offset-4 hover:underline"
            >
              {creator.sender.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              #{creator.sender.id} · 已发布 {creator.patchResourceCount} 份资源
            </p>
          </div>
          <span className="ml-auto">
            <StatusBadge status={creator.status} />
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        申请于 {formatChinaDateTime(creator.created)}
      </p>
      {isOpen(creator.status) ? (
        <div className="flex flex-wrap gap-2">
          <ReviewDialog creator={creator} action="approve" onDone={onDone} />
          <ReviewDialog creator={creator} action="decline" onDone={onDone} />
          {creator.sender && (
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/dashboard/resource?userId=${creator.sender.id}&userName=${encodeURIComponent(creator.sender.name)}`}
              >
                查看其资源
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">这份申请已处理。</p>
      )}
    </div>
  )
}

export function DashboardCreators() {
  return (
    <SearchableListPage<AdminCreator>
      config={LIST_CONFIG}
      title="创作者申请"
      noun="申请"
      contentLabel="申请"
      searchByUser={false}
      hideSearch
      columns={COLUMNS}
      toolbar={StatusSelect}
      card={(row) => ({
        text: row.sender?.name ?? '已注销',
        meta: `已发布 ${row.patchResourceCount} 份资源 · ${isOpen(row.status) ? '待处理' : APPLICANT_STATUS_MAP[row.status]}`
      })}
      detail={(row, actions) => (
        <CreatorDetail creator={row} onDone={() => actions.onDeleted(0)} />
      )}
    />
  )
}
