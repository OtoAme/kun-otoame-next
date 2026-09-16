'use client'

import Link from 'next/link'
import { ArrowRight, Clock3 } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  caseKindLabel,
  caseResolutionLabel,
  caseStatusHint,
  caseStatusLabel,
  caseTargetText,
  formatCaseDuration
} from '~/components/case/caseDisplay'
import type { InboxItem } from '~/types/api/inbox'

import { CASE_STATUS_BADGE_VARIANTS } from './caseBadges'

type CaseInboxItem = Extract<InboxItem, { kind: 'case' }>

interface CaseInboxDetailProps {
  item: CaseInboxItem
  /** Part of the inbox detail contract; a case is never handled from here. */
  onProcessed: (key: string) => void
  onStateChanged: (key: string) => void
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </>
  )
}

/**
 * Read-only inbox preview of a staff-owned case.
 *
 * The inbox keeps cases so the oldest one stays visible in the shared queue
 * (module 03 §7.4), but handling happens only in the case center: every
 * adjudication needs the full conversation, the target's current state and
 * the server-issued `capabilities`, none of which belong in a cross-source
 * queue. So this pane summarises what the inbox payload already carries and
 * hands off. It never fetches and never writes.
 */
export function CaseInboxDetail({ item }: CaseInboxDetailProps) {
  const { payload } = item
  const resolutionLabel = caseResolutionLabel(payload.resolution)
  const statusHint = caseStatusHint(payload)

  return (
    <div className="space-y-4" aria-label="事项预览">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            #{payload.id}
          </span>
          <h3 className="min-w-0 break-words text-base font-semibold">
            {caseTargetText(payload)}
          </h3>
          <Badge variant={CASE_STATUS_BADGE_VARIANTS[payload.status]}>
            {caseStatusLabel(payload.status)}
          </Badge>
          {resolutionLabel ? (
            <Badge variant="outline">{resolutionLabel}</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {caseKindLabel(payload.kind)} · 站方处理
        </p>
      </header>

      {statusHint ? (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{statusHint}</span>
        </p>
      ) : null}

      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
        <Field label="报告者">{item.actor?.name ?? '报告者'}</Field>
        <Field label="报告人数">{`${payload.subscriberCount} 人`}</Field>
        <Field label="已等待">
          {formatCaseDuration(item.waitingSeconds * 1000)}
        </Field>
        <Field label="创建时间">{formatChinaDateTime(payload.created)}</Field>
      </dl>

      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm text-muted-foreground">
          回复、结案与内容处置都在工单中心进行，那里能看到完整往来记录与可用裁决。
        </p>
        <Button asChild size="sm">
          <Link href={item.targetHref}>
            前往工单中心处理
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  )
}
