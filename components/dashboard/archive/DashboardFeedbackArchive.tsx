'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'

import {
  SearchableListPage,
  UserAvatar,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { Message } from '~/types/api/message'

import { ArchiveHandleDialog } from './ArchiveHandleDialog'

const LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/feedback',
  field: 'feedbacks',
  fallbackError: '获取旧反馈失败，请稍后重试'
}

// Handling a legacy record notifies its author; it stays super-admin-only.
const HANDLE_MIN_ROLE = 4

function StatusBadge({ status }: { status: number }) {
  return status ? (
    <Badge variant="outline">已处理</Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-amber-600/40 text-amber-700 dark:text-amber-400"
    >
      未处理
    </Badge>
  )
}

const COLUMNS: ListColumn<Message>[] = [
  {
    key: 'content',
    header: '反馈内容',
    grow: true,
    cell: (row) => (
      <span className="line-clamp-2 break-words">{row.content}</span>
    )
  },
  {
    key: 'sender',
    header: '反馈人',
    minWidth: 560,
    cell: (row) =>
      row.sender ? (
        <span className="flex items-center gap-2">
          <UserAvatar user={row.sender} />
          <span className="max-w-28 truncate">{row.sender.name}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">已注销</span>
      )
  },
  {
    key: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />
  },
  {
    key: 'created',
    header: '提交时间',
    minWidth: 720,
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">
        {formatChinaDateTime(row.created)}
      </span>
    )
  }
]

export function DashboardFeedbackArchive({
  viewerRole
}: {
  viewerRole: number
}) {
  const canHandle = viewerRole >= HANDLE_MIN_ROLE
  return (
    <SearchableListPage<Message>
      config={LIST_CONFIG}
      title="旧反馈"
      description={`站务反馈改用事项系统前提交的记录，原地只读保留。${canHandle ? '仍未处理的可以在这里回复并结束。' : '处理需超级管理员。'}`}
      noun="反馈"
      contentLabel="反馈"
      searchByUser={false}
      hideSearch
      columns={COLUMNS}
      card={(row) => ({
        text: row.content,
        meta: `${row.sender?.name ?? '已注销'} · ${row.status ? '已处理' : '未处理'}`
      })}
      detail={(row, actions) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {row.sender && (
              <Link
                href={`/user/${row.sender.id}`}
                prefetch={false}
                className="flex items-center gap-2 font-medium underline-offset-4 hover:underline"
              >
                <UserAvatar user={row.sender} />
                {row.sender.name}
              </Link>
            )}
            <span className="ml-auto">
              <StatusBadge status={row.status} />
            </span>
          </div>
          <p className="max-w-[40em] text-sm leading-7 break-words whitespace-pre-wrap">
            {row.content}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            提交于 {formatChinaDateTime(row.created)}
            {row.link && (
              <>
                {' · '}
                <a
                  href={row.link}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  打开相关页面
                </a>
              </>
            )}
          </p>
          {!row.status && canHandle && (
            <ArchiveHandleDialog
              trigger={
                <Button size="sm" className="self-start">
                  <Check />
                  标记已处理并回复
                </Button>
              }
              title="处理这条反馈"
              description="反馈人会收到一条系统通知，附上你的回复。"
              replyLabel="回复内容"
              endpoint="/admin/feedback/handle"
              body={{ messageId: row.id }}
              confirmLabel="确认处理"
              success="反馈已处理"
              onDone={() => actions.onUpdated()}
            />
          )}
        </div>
      )}
    />
  )
}
