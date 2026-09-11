'use client'

import type { ReactNode } from 'react'

import type { InboxItem } from '~/types/api/inbox'
import {
  KUN_GALGAME_RATING_PLAY_STATUS_MAP,
  KUN_GALGAME_RATING_RECOMMEND_MAP
} from '~/constants/galgame'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Separator } from '~/components/dashboard/ui/separator'

type LegacyInboxItem = Extract<InboxItem, { kind: 'feedback' | 'report' }>

/** http/https only, validated via URL parser (rejects javascript:, data:, protocol-relative, backslash tricks). */
const isSafeExternalUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
/** Site-relative only: single leading '/', never '//' or any backslash. */
const isSafeRelativeUrl = (value: string) =>
  value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')

const mapLabel = (labelMap: Record<string, string>, value: string) =>
  labelMap[value] ?? value

function EmptyValue() {
  return <span className="text-muted-foreground">无</span>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm leading-6">{children}</dd>
    </div>
  )
}

function TextValue({ value }: { value?: string | number | null }) {
  if (value === undefined || value === null || value === '') {
    return <EmptyValue />
  }
  return <span className="break-all">{value}</span>
}

/** User-supplied URL: link only for http/https (new tab) or single-/ site-relative paths; otherwise plain text. */
function SafeUrlValue({ value }: { value?: string | null }) {
  const url = (value ?? '').trim()
  if (!url) {
    return <EmptyValue />
  }
  if (isSafeExternalUrl(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline-offset-4 hover:underline"
      >
        {url}
      </a>
    )
  }
  if (isSafeRelativeUrl(url)) {
    return (
      <a
        href={url}
        className="break-all text-primary underline-offset-4 hover:underline"
      >
        {url}
      </a>
    )
  }
  return <span className="break-all">{url}</span>
}

function UserLink({ user }: { user: { id: number; name: string } }) {
  return (
    <a
      href={`/user/${user.id}`}
      className="text-primary underline-offset-4 hover:underline"
    >
      {user.name || `用户 ${user.id}`}
    </a>
  )
}

/** Readonly notice + official Button-as-link into the old admin backend. No mutation UI here. */
function LegacySection({ href }: { href: string }) {
  return (
    <>
      <Separator />
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">旧</Badge>
          <Button variant="outline" asChild>
            <a href={href}>去旧后台处理</a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          该条目为旧版数据，此处仅支持查看；处理需超级管理员权限。
        </p>
      </section>
    </>
  )
}

function FeedbackDetail({
  item
}: {
  item: Extract<LegacyInboxItem, { kind: 'feedback' }>
}) {
  const feedback = item.payload
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-tight">
            用户反馈 #{feedback.id}
          </h2>
          <Badge variant="secondary">反馈</Badge>
          <Badge variant="outline">只读</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          提交于 {formatChinaDateTime(feedback.created)}
        </p>
      </header>

      <dl className="space-y-2">
        <Field label="发送者">
          {feedback.sender ? (
            <UserLink user={feedback.sender} />
          ) : (
            <span>匿名用户</span>
          )}
        </Field>
        <Field label="提交时间">{formatChinaDateTime(feedback.created)}</Field>
        <Field label="关联链接">
          <SafeUrlValue value={feedback.link} />
        </Field>
      </dl>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">反馈内容</h3>
        {feedback.content ? (
          <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">
            {feedback.content}
          </p>
        ) : (
          <EmptyValue />
        )}
      </section>

      <LegacySection href={item.targetHref} />
    </div>
  )
}

function ReportDetail({
  item
}: {
  item: Extract<LegacyInboxItem, { kind: 'report' }>
}) {
  const report = item.payload
  const isComment = report.targetType === 'comment'
  const targetDeleted = isComment
    ? report.comment === null
    : report.rating === null

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-tight">
            {isComment ? '评论举报' : '评价举报'} #{report.id}
          </h2>
          <Badge variant="secondary">举报</Badge>
          <Badge variant="outline">{isComment ? '评论' : '评价'}</Badge>
          <Badge variant="outline">只读</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          举报于 {formatChinaDateTime(report.created)}
        </p>
      </header>

      <dl className="space-y-2">
        <Field label="所属游戏">
          <a
            href={`/${report.patch.uniqueId}`}
            className="break-all text-primary underline-offset-4 hover:underline"
          >
            {report.patch.name || report.patch.uniqueId}
          </a>
        </Field>
        <Field label="举报人">
          <UserLink user={report.sender} />
        </Field>
        <Field label="被举报用户">
          <UserLink user={report.reportedUser} />
        </Field>
        <Field label="举报时间">{formatChinaDateTime(report.created)}</Field>
      </dl>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">举报原因</h3>
        {report.reason ? (
          <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">
            {report.reason}
          </p>
        ) : (
          <EmptyValue />
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">被举报内容</h3>
        {targetDeleted ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            被举报内容已删除
          </p>
        ) : isComment && report.comment ? (
          <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">
            {report.comment.content || '（空评论）'}
          </p>
        ) : report.rating ? (
          <div className="space-y-3 rounded-md border p-3">
            <p className="whitespace-pre-wrap break-words text-sm">
              {report.rating.shortSummary || '（无评价内容）'}
            </p>
            <dl className="space-y-2 border-t pt-3">
              <Field label="总体评分">
                <TextValue value={report.rating.overall} />
              </Field>
              <Field label="推荐度">
                <TextValue
                  value={mapLabel(
                    KUN_GALGAME_RATING_RECOMMEND_MAP,
                    report.rating.recommend
                  )}
                />
              </Field>
              <Field label="游玩状态">
                <TextValue
                  value={mapLabel(
                    KUN_GALGAME_RATING_PLAY_STATUS_MAP,
                    report.rating.playStatus
                  )}
                />
              </Field>
            </dl>
          </div>
        ) : null}
      </section>

      <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        同目标其他待处理举报 {report.pendingForTarget} 条
      </p>

      <LegacySection href={item.targetHref} />
    </div>
  )
}

export function LegacyInboxDetail({ item }: { item: LegacyInboxItem }) {
  if (item.kind === 'feedback') {
    return <FeedbackDetail item={item} />
  }
  return <ReportDetail item={item} />
}
