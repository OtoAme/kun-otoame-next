'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
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
import { USER_ROLE_MAP, USER_STATUS_MAP } from '~/constants/user'
import {
  buildUsersQueryKey,
  useUsers,
  USER_PAGE_SIZE_OPTIONS,
  type UserSearchType
} from '~/hooks/dashboard/useUsers'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { UserEditDialog } from './UserEditDialog'
import { GrantMoemoepointDialog } from './GrantMoemoepointDialog'
import { DeleteUserDialog } from './DeleteUserDialog'

const SEARCH_TYPE_LABEL: Record<UserSearchType, string> = {
  name: '用户名',
  email: '邮箱',
  id: '用户 ID'
}

const SEARCH_PLACEHOLDER: Record<UserSearchType, string> = {
  name: '按用户名搜索，回车立即搜索',
  email: '按邮箱搜索，回车立即搜索',
  id: '按用户 ID 精确搜索（仅数字）'
}

const STATUS_BADGE_CLASS: Record<number, string> = {
  0: 'border-green-600/40 text-green-700 dark:text-green-400',
  1: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  2: 'border-red-600/40 text-red-700 dark:text-red-400'
}

const COLUMN_COUNT = 9
const SKELETON_ROWS = 8
const DEBOUNCE_MS = 500

export const DashboardUsers = ({
  currentUserId
}: {
  currentUserId: number
}) => {
  const {
    query,
    users,
    total,
    loading,
    refreshing,
    error,
    refresh,
    setPage,
    setLimit,
    setSearchType,
    commitSearch,
    notifyUpdated,
    notifyDeleted
  } = useUsers()

  const [searchInput, setSearchInput] = useState(query.search)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ownSearchNavKey = useRef<string | null>(null)
  const submitSearchRef = useRef<(raw: string) => void>(() => {})

  const submitSearch = useCallback(
    (raw: string) => {
      const value = raw.trim()
      if (value === query.search) return
      ownSearchNavKey.current = buildUsersQueryKey(
        1,
        query.limit,
        query.searchType,
        value.slice(0, 300)
      )
      commitSearch(value)
    },
    [query, commitSearch]
  )

  useEffect(() => {
    submitSearchRef.current = submitSearch
  }, [submitSearch])

  // Sync the input from the URL on ANY query-key change: back/forward can
  // change page/type/limit while the search text stays identical. Only a
  // search navigation we committed ourselves (matched by its full expected
  // query identity) keeps in-flight typing; every other key change cancels
  // the pending debounce so stale text can never overwrite the navigation.
  useEffect(() => {
    if (
      ownSearchNavKey.current !== null &&
      ownSearchNavKey.current === query.key
    ) {
      ownSearchNavKey.current = null
      return
    }
    ownSearchNavKey.current = null
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    setSearchInput(query.search)
  }, [query.key, query.search])

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
      submitSearchRef.current(value)
    }, DEBOUNCE_MS)
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    submitSearchRef.current(searchInput)
  }

  const blocked = query.idSearchError !== null
  const totalPages = Math.max(1, Math.ceil(total / query.limit))

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-wrap items-center gap-2"
        >
          <Select
            value={query.searchType}
            onValueChange={(value) => setSearchType(value as UserSearchType)}
          >
            <SelectTrigger className="w-[110px]" aria-label="搜索类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SEARCH_TYPE_LABEL) as UserSearchType[]).map(
                (type) => (
                  <SelectItem key={type} value={type}>
                    {SEARCH_TYPE_LABEL[type]}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <Input
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={SEARCH_PLACEHOLDER[query.searchType]}
            aria-label="搜索用户"
            maxLength={300}
            className="w-[240px] max-w-full"
          />
        </form>

        <Select
          value={String(query.limit)}
          onValueChange={(value) => setLimit(Number(value))}
        >
          <SelectTrigger className="w-[110px]" aria-label="每页条数">
            <SelectValue placeholder={`${query.limit} 条/页`} />
          </SelectTrigger>
          <SelectContent>
            {USER_PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={loading || refreshing || blocked}
        >
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {blocked && (
        <p className="text-sm text-destructive" role="alert">
          {query.idSearchError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>条目数</TableHead>
              <TableHead>资源数</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <TableRow key={`user-skeleton-${index}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-36" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-8 w-32" />
                  </TableCell>
                </TableRow>
              ))
            ) : error !== null ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
                  <div className="flex flex-col items-center justify-center gap-3 py-10">
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={refresh}
                    >
                      重试
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : blocked ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-32 whitespace-normal text-center text-sm text-muted-foreground"
                >
                  {query.idSearchError}
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-32 whitespace-normal text-center text-sm text-muted-foreground"
                >
                  {query.search === '' ? '暂无用户数据' : '未找到匹配的用户'}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link
                      href={`/user/${user.id}`}
                      prefetch={false}
                      className="flex items-center gap-2 underline-offset-4 hover:underline"
                    >
                      {user.avatar === '' ? (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                          {(user.name[0] ?? '?').toUpperCase()}
                        </span>
                      ) : (
                        <Image
                          src={user.avatar}
                          alt={user.name}
                          width={32}
                          height={32}
                          className="h-8 w-8 shrink-0 rounded-full object-cover"
                        />
                      )}
                      <span
                        className="block max-w-[160px] truncate font-medium"
                        title={user.name}
                      >
                        {user.name}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>{user.id}</TableCell>
                  <TableCell>
                    <span
                      className="block max-w-[220px] truncate"
                      title={user.email}
                    >
                      {user.email}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {USER_ROLE_MAP[user.role] ?? `角色 ${user.role}`}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={STATUS_BADGE_CLASS[user.status] ?? ''}
                    >
                      {USER_STATUS_MAP[user.status] ?? `状态 ${user.status}`}
                    </Badge>
                  </TableCell>
                  <TableCell>{user._count.patch}</TableCell>
                  <TableCell>{user._count.patch_resource}</TableCell>
                  <TableCell>{formatChinaDateTime(user.created)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserEditDialog user={user} onUpdated={notifyUpdated} />
                      <GrantMoemoepointDialog
                        user={user}
                        currentUserId={currentUserId}
                      />
                      <DeleteUserDialog
                        user={user}
                        currentUserId={currentUserId}
                        onDeleted={notifyDeleted}
                      />
                      <Link
                        href={`/dashboard/user/${user.id}/moemoepoint`}
                        prefetch={false}
                        className="text-sm whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        萌萌点明细
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          共 {total} 条 · 第 {blocked ? 1 : query.page} / {totalPages} 页
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(query.page - 1)}
            disabled={loading || blocked || query.page <= 1}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(query.page + 1)}
            disabled={loading || blocked || query.page >= totalPages}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  )
}
