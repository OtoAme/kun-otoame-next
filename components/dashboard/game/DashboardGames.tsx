'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ImageOff, Loader2, Pencil, Trash2 } from 'lucide-react'

import {
  SearchableListPage,
  UserAvatar,
  type FilterContext,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'
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
import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import { kunFetchDelete } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminGalgame } from '~/types/api/admin'

const RATING_LABELS: Record<string, string> = {
  sfw: '仅全年龄',
  nsfw: '仅成人'
}

const LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/otomegame',
  field: 'galgames',
  fallbackError: '获取游戏条目失败，请稍后重试',
  filters: { rating: (raw) => (raw in RATING_LABELS ? raw : null) },
  // Management lists show every content rating unless one is chosen.
  defaultParams: { rating: 'all' }
}

function RatingSelect({ filters, setFilters }: FilterContext) {
  return (
    <Select
      value={filters.rating ?? 'all'}
      onValueChange={(rating) =>
        setFilters({ rating: rating === 'all' ? '' : rating })
      }
    >
      <SelectTrigger className="w-[130px]" aria-label="内容分级">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部分级</SelectItem>
        {Object.entries(RATING_LABELS).map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Deleting an entry removes all of its resources; the API keeps it at super
// administrator, so only they see the action.
const DELETE_MIN_ROLE = 4

function Banner({ game, size }: { game: AdminGalgame; size: 'sm' | 'lg' }) {
  const box =
    size === 'sm' ? 'h-9 w-16 rounded-md' : 'aspect-video w-full rounded-lg'
  if (!game.banner) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center bg-muted text-muted-foreground ${box}`}
      >
        <ImageOff className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className={`relative block shrink-0 overflow-hidden bg-muted ${box}`}>
      <Image
        src={game.banner}
        alt=""
        fill
        sizes={size === 'sm' ? '64px' : '480px'}
        className="object-cover"
        unoptimized
      />
    </span>
  )
}

/** Typing the entry name is required, since the delete cannot be undone. */
function GameDeleteDialog({
  game,
  onDeleted
}: {
  game: AdminGalgame
  onDeleted: (count: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)

  const confirm = async () => {
    if (inflight.current || typed.trim() !== game.name.trim()) return
    inflight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await kunFetchDelete<Record<string, unknown> | string>(
        '/patch',
        { patchId: game.id }
      )
      if (typeof res === 'string') {
        setError(res || '删除失败，请稍后重试')
        return
      }
      toast.success(`已删除「${game.name}」`)
      setOpen(false)
      onDeleted(1)
    } catch {
      setError('网络错误，删除结果未知。请刷新列表核对后再决定是否重试。')
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
        if (!next) {
          setTyped('')
          setError(null)
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 />
          删除条目
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除游戏条目</AlertDialogTitle>
          <AlertDialogDescription>
            即将删除「{game.name}」(#{game.id}
            )。条目下的全部资源、下载链接、对象存储里的文件、评论与评价会一并删除，操作不可撤销。请输入条目名称确认。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          aria-label="输入条目名称确认删除"
          value={typed}
          placeholder={game.name}
          onChange={(event) => setTyped(event.target.value)}
        />
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
            variant="destructive"
            disabled={busy || typed.trim() !== game.name.trim()}
            onClick={confirm}
          >
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '删除中…' : '删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const COLUMNS: ListColumn<AdminGalgame>[] = [
  {
    key: 'banner',
    header: '封面',
    minWidth: 520,
    cell: (row) => <Banner game={row} size="sm" />
  },
  {
    key: 'name',
    header: '名称',
    grow: true,
    cell: (row) => (
      <span className="line-clamp-2 font-medium break-words">{row.name}</span>
    )
  },
  {
    key: 'publisher',
    header: '发布者',
    minWidth: 440,
    cell: (row) => (
      <span className="flex items-center gap-2">
        <UserAvatar user={row.user} />
        <span className="max-w-28 truncate">{row.user.name}</span>
      </span>
    )
  },
  {
    key: 'id',
    header: 'ID',
    minWidth: 820,
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">#{row.id}</span>
    )
  },
  {
    key: 'created',
    header: '创建时间',
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">
        {formatChinaDateTime(row.created)}
      </span>
    )
  }
]

function GameDetail({
  game,
  canDelete,
  onDeleted
}: {
  game: AdminGalgame
  canDelete: boolean
  onDeleted: (count: number) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <Banner game={game} size="lg" />
      <h4 className="text-base font-semibold break-words">{game.name}</h4>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">发布者</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <UserAvatar user={game.user} />
          <Link
            href={`/user/${game.user.id}`}
            prefetch={false}
            className="truncate underline-offset-4 hover:underline"
          >
            {game.user.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">创建时间</dt>
        <dd className="tabular-nums">{formatChinaDateTime(game.created)}</dd>
        <dt className="text-muted-foreground">条目 ID</dt>
        <dd className="tabular-nums">#{game.id}</dd>
        <dt className="text-muted-foreground">页面地址</dt>
        <dd className="font-mono text-xs break-all">/{game.uniqueId}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`/${game.uniqueId}`} target="_blank" rel="noreferrer">
            <Pencil />
            到游戏页编辑
          </a>
        </Button>
        {canDelete && <GameDeleteDialog game={game} onDeleted={onDeleted} />}
      </div>
    </div>
  )
}

export function DashboardGames({ viewerRole }: { viewerRole: number }) {
  const canDelete = viewerRole >= DELETE_MIN_ROLE
  return (
    <SearchableListPage<AdminGalgame>
      config={LIST_CONFIG}
      title="游戏条目"
      noun="条目"
      contentLabel="游戏名称"
      searchByUser={false}
      toolbar={RatingSelect}
      columns={COLUMNS}
      card={(row) => ({
        text: row.name,
        meta: `${row.user.name} · ${formatChinaDateTime(row.created)}`
      })}
      detail={(row, actions) => (
        <GameDetail
          game={row}
          canDelete={canDelete}
          onDeleted={actions.onDeleted}
        />
      )}
    />
  )
}
