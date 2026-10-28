'use client'

import Link from 'next/link'
import { convert } from 'html-to-text'
import { Ban, Trash2 } from 'lucide-react'

import {
  SearchableListPage,
  UserAvatar,
  type FilterContext,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { KUN_GALGAME_RATING_RECOMMEND_MAP } from '~/constants/galgame'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminLegacyReport } from '~/types/api/admin'

import { ArchiveHandleDialog } from './ArchiveHandleDialog'

const TARGET_LABELS: Record<string, string> = {
  comment: '评论举报',
  rating: '评价举报'
}
const TAB_LABELS: Record<string, string> = {
  pending: '未处理',
  handled: '已处理'
}

const LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/report',
  field: 'reports',
  fallbackError: '获取旧举报失败，请稍后重试',
  // The API takes one target and one tab per request.
  filters: {
    targetType: (raw) => (raw in TARGET_LABELS ? raw : null),
    tab: (raw) => (raw in TAB_LABELS ? raw : null)
  },
  defaultParams: { targetType: 'comment', tab: 'pending' }
}

const HANDLE_MIN_ROLE = 4

const STATUS: Record<number, [string, string]> = {
  0: ['未处理', 'border-amber-600/40 text-amber-700 dark:text-amber-400'],
  2: ['已删除内容', 'border-red-600/40 text-red-700 dark:text-red-400'],
  3: ['已驳回', '']
}

function StatusBadge({ status }: { status: number }) {
  const [text, tone] = STATUS[status] ?? [`状态 ${status}`, '']
  return (
    <Badge variant="outline" className={tone}>
      {text}
    </Badge>
  )
}

// Comments are stored as rendered HTML; show them as plain text like the
// legacy page does.
const targetText = (report: AdminLegacyReport) =>
  report.targetType === 'rating'
    ? (report.rating?.shortSummary ?? '被举报的评价已删除或不存在')
    : report.comment
      ? convert(report.comment.content).slice(0, 300)
      : '被举报的评论已删除或不存在'

function Toolbar({ filters, setFilters }: FilterContext) {
  return (
    <>
      <Select
        value={filters.targetType ?? 'comment'}
        onValueChange={(targetType) =>
          setFilters({ targetType: targetType === 'comment' ? '' : targetType })
        }
      >
        <SelectTrigger className="w-[120px] shrink-0" aria-label="举报对象">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(TARGET_LABELS).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.tab ?? 'pending'}
        onValueChange={(tab) =>
          setFilters({ tab: tab === 'pending' ? '' : tab })
        }
      >
        <SelectTrigger className="w-[110px] shrink-0" aria-label="处理状态">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(TAB_LABELS).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

const COLUMNS: ListColumn<AdminLegacyReport>[] = [
  {
    key: 'reason',
    header: '举报理由',
    grow: true,
    cell: (row) => (
      <span className="line-clamp-2 break-words">{row.reason}</span>
    )
  },
  {
    key: 'target',
    header: '被举报内容',
    minWidth: 620,
    cell: (row) => (
      <span className="line-clamp-1 block max-w-56 text-muted-foreground">
        {targetText(row)}
      </span>
    )
  },
  {
    key: 'reported',
    header: '被举报人',
    minWidth: 760,
    cell: (row) => (
      <span className="flex items-center gap-2">
        <UserAvatar user={row.reportedUser} />
        <span className="max-w-24 truncate">{row.reportedUser.name}</span>
      </span>
    )
  },
  {
    key: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />
  },
  {
    key: 'created',
    header: '举报时间',
    minWidth: 900,
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">
        {formatChinaDateTime(row.created)}
      </span>
    )
  }
]

function ReportDetail({
  report,
  canHandle,
  onDone
}: {
  report: AdminLegacyReport
  canHandle: boolean
  onDone: () => void
}) {
  const noun = report.targetType === 'rating' ? '评价' : '评论'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{TARGET_LABELS[report.targetType]}</Badge>
        <span className="ml-auto">
          <StatusBadge status={report.status} />
        </span>
      </div>
      <section>
        <h4 className="mb-1 text-xs text-muted-foreground">举报理由</h4>
        <p className="max-w-[40em] text-sm leading-7 break-words whitespace-pre-wrap">
          {report.reason}
        </p>
      </section>
      <section className="rounded-lg border p-3">
        <h4 className="mb-1 text-xs text-muted-foreground">
          被举报的{noun}
          {report.rating &&
            ` · ${report.rating.overall} 分 · ${KUN_GALGAME_RATING_RECOMMEND_MAP[report.rating.recommend] ?? report.rating.recommend}`}
        </h4>
        <p className="text-sm leading-6 break-words whitespace-pre-wrap">
          {targetText(report)}
        </p>
      </section>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">所属游戏</dt>
        <dd className="min-w-0 break-words">
          <a
            href={`/${report.patch.uniqueId}`}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            {report.patch.name}
          </a>
        </dd>
        <dt className="text-muted-foreground">举报人</dt>
        <dd>
          <Link
            href={`/user/${report.sender.id}`}
            prefetch={false}
            className="underline-offset-4 hover:underline"
          >
            {report.sender.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">被举报人</dt>
        <dd>
          <Link
            href={`/user/${report.reportedUser.id}`}
            prefetch={false}
            className="underline-offset-4 hover:underline"
          >
            {report.reportedUser.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">举报时间</dt>
        <dd className="tabular-nums">{formatChinaDateTime(report.created)}</dd>
        {report.handledAt && (
          <>
            <dt className="text-muted-foreground">处理时间</dt>
            <dd className="tabular-nums">
              {formatChinaDateTime(report.handledAt)}
            </dd>
          </>
        )}
        {report.handlerReply && (
          <>
            <dt className="text-muted-foreground">处理回复</dt>
            <dd className="break-words whitespace-pre-wrap">
              {report.handlerReply}
            </dd>
          </>
        )}
      </dl>
      {report.status === 0 && canHandle && (
        <div className="flex flex-wrap gap-2">
          <ArchiveHandleDialog
            trigger={
              <Button size="sm" variant="destructive">
                <Trash2 />
                删除{noun}
              </Button>
            }
            title={`删除被举报的${noun}`}
            description={`该${noun}会被删除，针对它的所有未处理举报一并结束，举报人收到处理通知。删除不可撤销。`}
            replyLabel="处理说明"
            endpoint="/admin/report/handle"
            body={{ reportId: report.id, action: 'delete' }}
            confirmLabel="确认删除"
            destructive
            success="已删除并结束举报"
            onDone={onDone}
          />
          <ArchiveHandleDialog
            trigger={
              <Button size="sm" variant="outline">
                <Ban />
                驳回
              </Button>
            }
            title="驳回举报"
            description={`${noun}保留，针对它的所有未处理举报一并结束，举报人收到驳回通知。`}
            replyLabel="驳回说明"
            endpoint="/admin/report/handle"
            body={{ reportId: report.id, action: 'reject' }}
            confirmLabel="确认驳回"
            success="已驳回举报"
            onDone={onDone}
          />
        </div>
      )}
    </div>
  )
}

export function DashboardReportArchive({ viewerRole }: { viewerRole: number }) {
  const canHandle = viewerRole >= HANDLE_MIN_ROLE
  return (
    <SearchableListPage<AdminLegacyReport>
      config={LIST_CONFIG}
      title="旧举报"
      description={`评论和评价举报改用事项系统前的记录，原地只读保留；小喇叭举报在小喇叭管理页处理。${canHandle ? '仍未处理的可以在这里删除内容或驳回。' : '处理需超级管理员。'}`}
      noun="举报"
      contentLabel="举报"
      searchByUser={false}
      hideSearch
      columns={COLUMNS}
      toolbar={Toolbar}
      card={(row) => ({
        text: row.reason,
        meta: `${TARGET_LABELS[row.targetType]} · ${STATUS[row.status]?.[0] ?? row.status}`
      })}
      detail={(row, actions) => (
        <ReportDetail
          report={row}
          canHandle={canHandle}
          onDone={() => actions.onDeleted(1)}
        />
      )}
    />
  )
}
