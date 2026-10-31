'use client'

import {
  SearchableListPage,
  UserAvatar,
  UserPicker,
  type FilterChip,
  type FilterContext,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import { Badge } from '~/components/dashboard/ui/badge'
import { Label } from '~/components/dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { ADMIN_LOG_TYPE_MAP } from '~/constants/admin'
import type {
  ListFilters,
  SearchableListConfig
} from '~/hooks/dashboard/useSearchableList'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  LOG_EMAIL_SEARCH_DENIED,
  LOG_FULL_CONTENT_MIN_ROLE,
  searchesIntoEmail
} from '~/utils/maskEmail'
import type { AdminLog } from '~/types/api/admin'

const ALL = '__all'

const LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/log',
  field: 'logs',
  fallbackError: '获取管理日志失败，请稍后重试',
  filters: {
    type: (raw) => (raw in ADMIN_LOG_TYPE_MAP ? raw : null),
    userId: (raw) => (/^[1-9]\d{0,6}$/.test(raw) ? raw : null),
    userName: (raw) => raw.slice(0, 17) || null
  },
  displayOnly: ['userName']
}

const typeLabel = (type: string) => ADMIN_LOG_TYPE_MAP[type] ?? type

function LogFilters({ filters, setFilters }: FilterContext) {
  return (
    <>
      <Select
        value={filters.type ?? ALL}
        onValueChange={(type) => setFilters({ type: type === ALL ? '' : type })}
      >
        <SelectTrigger className="w-[160px] shrink-0" aria-label="操作类型">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部类型</SelectItem>
          {Object.entries(ADMIN_LOG_TYPE_MAP).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Label htmlFor="log-filter-user" className="sr-only">
          操作人
        </Label>
        <UserPicker
          id="log-filter-user"
          className="w-full sm:w-52"
          selected={
            filters.userId
              ? {
                  id: Number(filters.userId),
                  name: filters.userName || `#${filters.userId}`
                }
              : null
          }
          onSelect={(user) =>
            setFilters({
              userId: user ? String(user.id) : '',
              userName: user?.name ?? ''
            })
          }
        />
      </div>
    </>
  )
}

const chips = (filters: ListFilters): FilterChip[] => [
  ...(filters.type
    ? [{ key: 'type', label: `类型：${typeLabel(filters.type)}` }]
    : []),
  ...(filters.userId
    ? [
        {
          key: 'userId',
          label: `操作人：${filters.userName || `#${filters.userId}`}`,
          keys: ['userId', 'userName']
        }
      ]
    : [])
]

const COLUMNS: ListColumn<AdminLog>[] = [
  {
    key: 'user',
    header: '操作人',
    cell: (row) => (
      <span className="flex items-center gap-2">
        <UserAvatar user={row.user} />
        <span className="max-w-24 truncate">{row.user.name}</span>
      </span>
    )
  },
  {
    key: 'type',
    header: '类型',
    cell: (row) => <Badge variant="secondary">{typeLabel(row.type)}</Badge>
  },
  {
    key: 'content',
    header: '内容',
    grow: true,
    cell: (row) => (
      <span className="line-clamp-2 break-words">{row.content}</span>
    )
  },
  {
    key: 'raw',
    header: '类型标识',
    minWidth: 1000,
    cell: (row) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.type}
      </span>
    )
  },
  {
    key: 'created',
    header: '时间',
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">
        {formatChinaDateTime(row.created)}
      </span>
    )
  }
]

export function DashboardLogs({ viewerRole }: { viewerRole: number }) {
  // Below role 4 the server masks emails; say so before the request fails.
  const masked = viewerRole < LOG_FULL_CONTENT_MIN_ROLE
  return (
    <SearchableListPage<AdminLog>
      validateSearch={
        masked
          ? (term) => (searchesIntoEmail(term) ? LOG_EMAIL_SEARCH_DENIED : null)
          : undefined
      }
      searchPlaceholder={
        masked ? '搜索日志内容（邮箱已隐藏，不能按邮箱搜索）' : undefined
      }
      config={LIST_CONFIG}
      title="管理日志"
      description="全部管理员的操作记录，按时间倒序。可按内容关键词、操作类型和操作人筛选。"
      noun="日志"
      contentLabel="日志内容"
      searchByUser={false}
      columns={COLUMNS}
      toolbar={LogFilters}
      filterChips={chips}
      card={(row) => ({
        text: row.content,
        meta: `${row.user.name} · ${typeLabel(row.type)} · ${formatChinaDateTime(row.created)}`
      })}
      detail={(row) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <UserAvatar user={row.user} />
            <span className="font-medium">{row.user.name}</span>
            <Badge variant="secondary">{typeLabel(row.type)}</Badge>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {formatChinaDateTime(row.created)}
            </span>
          </div>
          <pre className="max-h-[60svh] overflow-auto rounded-lg border bg-muted/40 p-3 font-sans text-sm leading-6 break-words whitespace-pre-wrap">
            {row.content}
          </pre>
          <p className="text-xs text-muted-foreground">
            日志 #{row.id} · 类型标识 <code>{row.type}</code>
          </p>
        </div>
      )}
    />
  )
}
