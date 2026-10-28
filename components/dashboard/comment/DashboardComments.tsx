'use client'

import Link from 'next/link'
import { ExternalLink, ThumbsUp } from 'lucide-react'

import {
  SearchableListPage,
  UserAvatar,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import {
  COMMENT_RECORD,
  RecordDeleteDialog,
  RecordEditDialog
} from '~/components/dashboard/page/RecordDialogs'
import { Button } from '~/components/dashboard/ui/button'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminComment } from '~/types/api/admin'

const LIST_CONFIG = {
  endpoint: '/admin/comment',
  field: 'comments',
  fallbackError: '获取评论列表失败，请稍后重试'
}

const COLUMNS: ListColumn<AdminComment>[] = [
  {
    key: 'content',
    header: '内容',
    grow: true,
    cell: (row) => (
      <span className="line-clamp-2 break-words">{row.content}</span>
    )
  },
  {
    key: 'author',
    header: '作者',
    cell: (row) => (
      <span className="flex items-center gap-2">
        <UserAvatar user={row.user} />
        <span className="max-w-28 truncate">{row.user.name}</span>
      </span>
    )
  },
  {
    key: 'game',
    header: '游戏',
    minWidth: 560,
    cell: (row) => (
      <span className="block max-w-40 truncate">{row.patchName}</span>
    )
  },
  {
    key: 'like',
    header: '点赞',
    minWidth: 720,
    align: 'right',
    cell: (row) => (
      <span className="inline-flex items-center gap-1">
        <ThumbsUp className="size-3.5 text-muted-foreground" />
        {row.like}
      </span>
    )
  },
  {
    key: 'id',
    header: 'ID',
    minWidth: 900,
    cell: (row) => (
      <span className="text-muted-foreground tabular-nums">#{row.id}</span>
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
        <RecordEditDialog
          kind={COMMENT_RECORD}
          id={comment.id}
          onUpdated={onUpdated}
        />
        <Button variant="outline" size="sm" asChild>
          <a href={`/${comment.uniqueId}`} target="_blank" rel="noreferrer">
            <ExternalLink />
            在前台查看
          </a>
        </Button>
        <RecordDeleteDialog
          kind={COMMENT_RECORD}
          ids={[comment.id]}
          label="删除"
          onDeleted={onDeleted}
        />
      </div>
    </div>
  )
}

export function DashboardComments() {
  return (
    <SearchableListPage<AdminComment>
      config={LIST_CONFIG}
      title="评论"
      description="按内容或用户查找评论。编辑与删除会写入管理日志，删除时其下的回复一并删除。"
      noun="评论"
      contentLabel="评论内容"
      columns={COLUMNS}
      card={(row) => ({
        text: row.content,
        meta: `${row.user.name} · ${row.patchName} · ${formatChinaDateTime(row.created)}`
      })}
      detail={(row, actions) => <CommentDetail comment={row} {...actions} />}
      batchDelete={({ ids, onDeleted }) => (
        <RecordDeleteDialog
          kind={COMMENT_RECORD}
          ids={ids}
          label="批量删除"
          onDeleted={onDeleted}
        />
      )}
    />
  )
}
