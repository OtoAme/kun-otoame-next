'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import Link from 'next/link'
import { ExternalLink, ThumbsUp, X } from 'lucide-react'

import {
  DashboardMasterDetail,
  DashboardPage,
  DashboardPagination,
  DashboardPanel
} from '~/components/dashboard/page/DashboardPage'
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from '~/components/dashboard/ui/avatar'
import { Button } from '~/components/dashboard/ui/button'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/dashboard/ui/table'
import {
  COMMENT_PAGE_SIZE_OPTIONS,
  useComments,
  type CommentSearchType
} from '~/hooks/dashboard/useComments'
import { useElementWidth } from '~/hooks/dashboard/useElementWidth'
import { kunFetchGet } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminComment } from '~/types/api/admin'

import { CommentDeleteDialog, CommentEditDialog } from './CommentDialogs'

const SEARCH_TYPE_LABEL: Record<CommentSearchType, string> = {
  content: '评论内容',
  user: '用户'
}
const DEBOUNCE_MS = 500
const SKELETON_ROWS = 8

function UserAvatar({ user }: { user: KunUser }) {
  return (
    <Avatar size="sm">
      {user.avatar && <AvatarImage src={user.avatar} alt="" />}
      <AvatarFallback>{(user.name[0] ?? '?').toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

/** Author picker for user searches, backed by the mention search. */
function UserPicker({
  selected,
  onSelect
}: {
  selected: { id: number; name: string } | null
  onSelect: (user: { id: number; name: string } | null) => void
}) {
  const [text, setText] = useState('')
  const [options, setOptions] = useState<KunUser[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const value = text.trim()
    if (!value) {
      setOptions([])
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await kunFetchGet<KunUser[] | string>(
          '/user/mention/search',
          { query: value.slice(0, 20) }
        )
        if (active) setOptions(Array.isArray(res) ? res.slice(0, 10) : [])
      } catch {
        if (active) setOptions([])
      } finally {
        if (active) setLoading(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [text])

  if (selected) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
        <span className="text-muted-foreground">用户</span>
        <span className="font-medium">{selected.name}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="清除用户"
          onClick={() => onSelect(null)}
        >
          <X />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative w-full sm:w-64">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="输入用户名查找"
        aria-label="查找用户"
        maxLength={20}
      />
      {text.trim() && (
        <ul
          role="listbox"
          aria-label="匹配的用户"
          className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {loading ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              查找中…
            </li>
          ) : options.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              没有匹配的用户
            </li>
          ) : (
            options.map((user) => (
              <li key={user.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    setText('')
                    onSelect({ id: user.id, name: user.name })
                  }}
                >
                  <UserAvatar user={user} />
                  {user.name}
                  <span className="ml-auto text-xs text-muted-foreground">
                    #{user.id}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function CommentDetail({
  comment,
  onUpdated,
  onDeleted
}: {
  comment: AdminComment
  onUpdated: () => void
  onDeleted: (count: number) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[40em] text-sm leading-7 break-words whitespace-pre-wrap">
        {comment.content}
      </p>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">作者</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <UserAvatar user={comment.user} />
          <Link
            href={`/user/${comment.user.id}`}
            prefetch={false}
            className="truncate underline-offset-4 hover:underline"
          >
            {comment.user.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">所属游戏</dt>
        <dd className="min-w-0 break-words">{comment.patchName}</dd>
        <dt className="text-muted-foreground">点赞</dt>
        <dd className="tabular-nums">{comment.like}</dd>
        <dt className="text-muted-foreground">发布时间</dt>
        <dd className="tabular-nums">{formatChinaDateTime(comment.created)}</dd>
        <dt className="text-muted-foreground">评论 ID</dt>
        <dd className="tabular-nums">#{comment.id}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        列表只显示评论的前 233 个字；编辑时读取全文。
      </p>
      <div className="flex flex-wrap gap-2">
        <CommentEditDialog commentId={comment.id} onUpdated={onUpdated} />
        <Button variant="outline" size="sm" asChild>
          <a href={`/${comment.uniqueId}`} target="_blank" rel="noreferrer">
            <ExternalLink />
            在前台查看
          </a>
        </Button>
        <CommentDeleteDialog
          commentIds={[comment.id]}
          label="删除"
          onDeleted={onDeleted}
        />
      </div>
    </div>
  )
}

export function DashboardComments() {
  const {
    query,
    comments,
    total,
    loading,
    refreshing,
    error,
    refresh,
    setPage,
    setLimit,
    setSearchType,
    commitSearch,
    selectUser,
    select,
    notifyDeleted
  } = useComments()

  const [searchInput, setSearchInput] = useState(query.search)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [listRef, listWidth] = useElementWidth<HTMLElement>()
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())

  // Back/forward or a cleared search resets the input to the URL.
  useEffect(() => {
    setSearchInput(query.search)
  }, [query.search, query.searchType])

  // Checked rows only survive while they are still visible.
  useEffect(() => {
    setChecked((prev) => {
      const visible = new Set(comments.map((comment) => comment.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [comments])

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    },
    []
  )

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setSearchInput(value)
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null
      commitSearch(value)
    }, DEBOUNCE_MS)
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    commitSearch(searchInput)
  }

  const selected =
    comments.find((comment) => comment.id === query.selected) ?? null

  const handleUpdated = useCallback(() => refresh(), [refresh])
  const handleDeleted = useCallback(
    (count: number) => {
      setChecked(new Set())
      notifyDeleted(count)
    },
    [notifyDeleted]
  )

  // Arrow keys move the selection through the visible rows.
  const handleRowKey = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(comments[index].id)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next =
      comments[
        Math.min(
          comments.length - 1,
          Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))
        )
      ]
    if (!next) return
    select(next.id)
    rowRefs.current.get(next.id)?.focus()
  }

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        query.selected !== null &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        select(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [query.selected, select])

  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const allChecked =
    comments.length > 0 && comments.every((comment) => checked.has(comment.id))
  // Columns are added as the list gets wider rather than stretched.
  const showGame = listWidth >= 560
  const showLikes = listWidth >= 720
  const showId = listWidth >= 900
  const asCards = listWidth > 0 && listWidth < 480
  const columnCount = 4 + Number(showGame) + Number(showLikes) + Number(showId)

  const searchControls = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={query.searchType}
        onValueChange={(value) => setSearchType(value as CommentSearchType)}
      >
        <SelectTrigger className="w-[120px]" aria-label="搜索范围">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SEARCH_TYPE_LABEL) as CommentSearchType[]).map(
            (type) => (
              <SelectItem key={type} value={type}>
                {SEARCH_TYPE_LABEL[type]}
              </SelectItem>
            )
          )}
        </SelectContent>
      </Select>
      {query.searchType === 'content' ? (
        <form onSubmit={handleSearchSubmit} className="w-full sm:w-64">
          <Input
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="搜索评论内容，回车立即搜索"
            aria-label="搜索评论内容"
            maxLength={300}
          />
        </form>
      ) : (
        <UserPicker
          selected={
            query.userId === null
              ? null
              : {
                  id: query.userId,
                  name: query.userName || `#${query.userId}`
                }
          }
          onSelect={selectUser}
        />
      )}
    </div>
  )

  const list = (
    <DashboardPanel ref={listRef}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        {searchControls}
        <span className="flex-1" />
        {checked.size > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            已选 {checked.size} 条
          </span>
        )}
        <CommentDeleteDialog
          commentIds={[...checked]}
          label="批量删除"
          onDeleted={handleDeleted}
        />
      </div>

      {error !== null ? (
        <div className="flex flex-col items-center gap-3 border-t px-4 py-10">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            重试
          </Button>
        </div>
      ) : asCards ? (
        <ul className="border-t">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => (
                <li key={index} className="border-b p-3 last:border-b-0">
                  <Skeleton className="h-10 w-full" />
                </li>
              ))
            : comments.map((comment) => (
                <li
                  key={comment.id}
                  className="flex gap-3 border-b p-3 last:border-b-0"
                >
                  <Checkbox
                    aria-label={`选择评论 ${comment.id}`}
                    checked={checked.has(comment.id)}
                    onCheckedChange={(value) =>
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (value === true) next.add(comment.id)
                        else next.delete(comment.id)
                        return next
                      })
                    }
                    className="mt-1"
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => select(comment.id)}
                  >
                    <span className="line-clamp-3 text-sm break-words">
                      {comment.content}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {comment.user.name} · {comment.patchName} ·{' '}
                      {formatChinaDateTime(comment.created)}
                    </span>
                  </button>
                </li>
              ))}
        </ul>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="全选当前页"
                    checked={allChecked}
                    disabled={comments.length === 0}
                    onCheckedChange={(value) =>
                      setChecked(
                        value === true
                          ? new Set(comments.map((comment) => comment.id))
                          : new Set()
                      )
                    }
                  />
                </TableHead>
                <TableHead>内容</TableHead>
                <TableHead>作者</TableHead>
                {showGame && <TableHead>游戏</TableHead>}
                {showLikes && (
                  <TableHead className="text-right">点赞</TableHead>
                )}
                {showId && <TableHead>ID</TableHead>}
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={columnCount}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : comments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    className="h-32 text-center whitespace-normal text-muted-foreground"
                  >
                    {query.search || query.userId !== null
                      ? '没有匹配的评论，换个关键词或用户再试。'
                      : '还没有评论。'}
                  </TableCell>
                </TableRow>
              ) : (
                comments.map((comment, index) => (
                  <TableRow
                    key={comment.id}
                    ref={(node) => {
                      if (node) rowRefs.current.set(comment.id, node)
                      else rowRefs.current.delete(comment.id)
                    }}
                    tabIndex={0}
                    aria-selected={comment.id === query.selected}
                    data-state={
                      comment.id === query.selected ? 'selected' : undefined
                    }
                    onClick={() => select(comment.id)}
                    onKeyDown={(event) => handleRowKey(event, index)}
                    className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none data-[state=selected]:shadow-[inset_3px_0_0_var(--primary)]"
                  >
                    <TableCell
                      className="pl-4"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        aria-label={`选择评论 ${comment.id}`}
                        checked={checked.has(comment.id)}
                        onCheckedChange={(value) =>
                          setChecked((prev) => {
                            const next = new Set(prev)
                            if (value === true) next.add(comment.id)
                            else next.delete(comment.id)
                            return next
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="max-w-0 min-w-48 whitespace-normal">
                      <span className="line-clamp-2 break-words">
                        {comment.content}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <UserAvatar user={comment.user} />
                        <span className="max-w-28 truncate">
                          {comment.user.name}
                        </span>
                      </span>
                    </TableCell>
                    {showGame && (
                      <TableCell>
                        <span className="block max-w-40 truncate">
                          {comment.patchName}
                        </span>
                      </TableCell>
                    )}
                    {showLikes && (
                      <TableCell className="text-right tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <ThumbsUp className="size-3.5 text-muted-foreground" />
                          {comment.like}
                        </span>
                      </TableCell>
                    )}
                    {showId && (
                      <TableCell className="text-muted-foreground tabular-nums">
                        #{comment.id}
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatChinaDateTime(comment.created)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <DashboardPagination
        page={query.page}
        totalPages={totalPages}
        total={total}
        unit="条"
        disabled={loading}
        onPageChange={setPage}
      >
        <Select
          value={String(query.limit)}
          onValueChange={(value) => setLimit(Number(value))}
        >
          <SelectTrigger size="sm" className="w-[110px]" aria-label="每页条数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMENT_PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DashboardPagination>
    </DashboardPanel>
  )

  return (
    <DashboardPage
      title="评论"
      description="按内容或用户查找评论。编辑与删除会写入管理日志，删除时其下的回复一并删除。"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading || refreshing}
        >
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      <DashboardMasterDetail
        list={list}
        detail={
          selected ? (
            <CommentDetail
              comment={selected}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ) : null
        }
        detailTitle={selected ? `评论 #${selected.id}` : '详情'}
        emptyDetail={
          <p className="text-sm text-muted-foreground">
            选择一条评论查看全文与操作。
          </p>
        }
        onCloseDetail={() => select(null)}
      />
    </DashboardPage>
  )
}
