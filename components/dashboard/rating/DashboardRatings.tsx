'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Eye, EyeOff, ThumbsUp } from 'lucide-react'

import {
  SearchableListPage,
  UserAvatar,
  type ListColumn
} from '~/components/dashboard/page/SearchableListPage'
import {
  RATING_RECORD,
  RecordDeleteDialog,
  RecordEditDialog
} from '~/components/dashboard/page/RecordDialogs'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  KUN_GALGAME_RATING_PLAY_STATUS_MAP,
  KUN_GALGAME_RATING_RECOMMEND_MAP,
  KUN_GALGAME_RATING_SPOILER_MAP
} from '~/constants/galgame'
import { cn } from '~/lib/dashboard/utils'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminRating } from '~/types/api/admin'

const LIST_CONFIG = {
  endpoint: '/admin/rating',
  field: 'ratings',
  fallbackError: '获取评价列表失败，请稍后重试'
}

const RECOMMEND_CLASS: Record<string, string> = {
  strong_yes: 'border-green-600/40 text-green-700 dark:text-green-400',
  yes: 'border-sky-600/40 text-sky-700 dark:text-sky-400',
  neutral: '',
  no: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  strong_no: 'border-red-600/40 text-red-700 dark:text-red-400'
}

function Recommend({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={cn(RECOMMEND_CLASS[value])}>
      {KUN_GALGAME_RATING_RECOMMEND_MAP[value] ?? value}
    </Badge>
  )
}

const hasSpoiler = (rating: AdminRating) =>
  Boolean(rating.shortSummary) && rating.spoilerLevel !== 'none'

/** List text for a summary: a spoiler stays hidden until the detail opens. */
function SummaryText({ rating }: { rating: AdminRating }) {
  if (hasSpoiler(rating)) {
    return (
      <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <EyeOff className="size-3.5 shrink-0" aria-hidden />
        {KUN_GALGAME_RATING_SPOILER_MAP[rating.spoilerLevel] ?? '本评分有剧透'}
        ，打开详情查看
      </span>
    )
  }
  return <span className="line-clamp-2 break-words">{rating.shortSummary}</span>
}

const COLUMNS: ListColumn<AdminRating>[] = [
  {
    key: 'summary',
    header: '短评',
    grow: true,
    cell: (row) => <SummaryText rating={row} />
  },
  {
    key: 'overall',
    header: '评分',
    align: 'right',
    cell: (row) => <span className="font-medium">{row.overall}</span>
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
    key: 'recommend',
    header: '推荐',
    minWidth: 620,
    cell: (row) => <Recommend value={row.recommend} />
  },
  {
    key: 'game',
    header: '游戏',
    minWidth: 760,
    cell: (row) => (
      <span className="block max-w-40 truncate">{row.patchName}</span>
    )
  },
  {
    key: 'like',
    header: '点赞',
    minWidth: 900,
    align: 'right',
    cell: (row) => (
      <span className="inline-flex items-center gap-1">
        <ThumbsUp className="size-3.5 text-muted-foreground" />
        {row.like}
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

function RatingDetail({
  rating,
  onUpdated,
  onDeleted
}: {
  rating: AdminRating
  onUpdated: () => void
  onDeleted: (count: number) => void
}) {
  // Same rule as the game page: a spoiler summary is shown only on request.
  const [revealed, setRevealed] = useState(false)
  const spoiler = hasSpoiler(rating)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-3xl font-semibold tabular-nums">
          {rating.overall}
        </span>
        <span className="text-sm text-muted-foreground">/ 10</span>
        <Recommend value={rating.recommend} />
      </div>
      {spoiler ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start border-amber-600/40 text-amber-700 dark:text-amber-400"
          aria-expanded={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? <Eye /> : <EyeOff />}
          {KUN_GALGAME_RATING_SPOILER_MAP[rating.spoilerLevel] ??
            '本评分有剧透'}
          {revealed ? ' · 点击隐藏' : ' · 点击显示'}
        </Button>
      ) : null}
      {!spoiler || revealed ? (
        <p className="max-w-[40em] text-sm leading-7 break-words whitespace-pre-wrap">
          {rating.shortSummary}
        </p>
      ) : null}
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">作者</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <UserAvatar user={rating.user} />
          <Link
            href={`/user/${rating.user.id}`}
            prefetch={false}
            className="truncate underline-offset-4 hover:underline"
          >
            {rating.user.name}
          </Link>
        </dd>
        <dt className="text-muted-foreground">所属游戏</dt>
        <dd className="min-w-0 break-words">{rating.patchName}</dd>
        <dt className="text-muted-foreground">游玩状态</dt>
        <dd>
          {KUN_GALGAME_RATING_PLAY_STATUS_MAP[rating.playStatus] ??
            rating.playStatus}
        </dd>
        <dt className="text-muted-foreground">剧透</dt>
        <dd>
          {KUN_GALGAME_RATING_SPOILER_MAP[rating.spoilerLevel] ??
            rating.spoilerLevel}
        </dd>
        <dt className="text-muted-foreground">点赞</dt>
        <dd className="tabular-nums">{rating.like}</dd>
        <dt className="text-muted-foreground">发布时间</dt>
        <dd className="tabular-nums">{formatChinaDateTime(rating.created)}</dd>
        <dt className="text-muted-foreground">评价 ID</dt>
        <dd className="tabular-nums">#{rating.id}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        控制台只能修改短评文字；评分与推荐由作者本人修改。
      </p>
      <div className="flex flex-wrap gap-2">
        <RecordEditDialog
          kind={RATING_RECORD}
          id={rating.id}
          onUpdated={onUpdated}
        />
        <Button variant="outline" size="sm" asChild>
          <a href={`/${rating.uniqueId}`} target="_blank" rel="noreferrer">
            <ExternalLink />
            在前台查看
          </a>
        </Button>
        <RecordDeleteDialog
          kind={RATING_RECORD}
          ids={[rating.id]}
          label="删除"
          onDeleted={onDeleted}
        />
      </div>
    </div>
  )
}

export function DashboardRatings() {
  return (
    <SearchableListPage<AdminRating>
      config={LIST_CONFIG}
      title="评价"
      description="按短评内容或用户查找评价。编辑与删除会写入管理日志。"
      noun="评价"
      contentLabel="短评内容"
      columns={COLUMNS}
      card={(row) => ({
        text: <SummaryText rating={row} />,
        meta: `${row.overall} 分 · ${row.user.name} · ${row.patchName}`
      })}
      detail={(row, actions) => (
        // Keyed so a revealed spoiler is hidden again on the next rating.
        <RatingDetail key={row.id} rating={row} {...actions} />
      )}
      batchDelete={({ ids, onDeleted }) => (
        <RecordDeleteDialog
          kind={RATING_RECORD}
          ids={ids}
          label="批量删除"
          onDeleted={onDeleted}
        />
      )}
    />
  )
}
