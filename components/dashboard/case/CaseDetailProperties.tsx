'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Clock3 } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { CASE_TARGET_TYPE_LABELS } from '~/constants/case'
import {
  caseKindLabel,
  caseResolutionLabel,
  caseResourceStatusLabel,
  caseStatusHint,
  caseStatusLabel,
  caseTargetText
} from '~/components/case/caseDisplay'
import type { CaseDetail, CaseUserSummary } from '~/types/api/case'

import { CASE_STATUS_BADGE_VARIANTS } from './caseBadges'

/** The dashboard user list opened on one user (review item 5). */
export const userManagementHref = (userId: number) =>
  `/dashboard/user?searchType=id&search=${userId}`

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </>
  )
}

function PanelSection({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

function SiteLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  )
}

/** A user's site profile plus the dashboard's user management entry. */
function UserLinks({ user }: { user: Pick<CaseUserSummary, 'id' | 'name'> }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <SiteLink href={`/user/${user.id}`}>{user.name}</SiteLink>
      <Link
        href={userManagementHref(user.id)}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        用户管理
      </Link>
    </span>
  )
}

/**
 * Target block. A deleted target is stated plainly instead of erroring, per
 * module 03 §3.5 —— the case stays resolvable either way. A violation report
 * shows what was reported, so a decision is never made on an id alone
 * (review item 3).
 */
function TargetBlock({ detail }: { detail: CaseDetail }) {
  const { target } = detail
  const typeLabel =
    CASE_TARGET_TYPE_LABELS[detail.targetType] ?? detail.targetType
  if (target.deleted) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {typeLabel}目标已删除，事项仍可结案
      </p>
    )
  }
  const resourcePatch = target.resource?.patch
  const content = target.content
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
        <Field label="目标类型">{typeLabel}</Field>
        <Field label="目标">
          {detail.targetType === 'user' ? (
            content?.author ? (
              <UserLinks user={content.author} />
            ) : (
              <SiteLink href={`/user/${detail.targetId}`}>
                {target.label || `用户 #${detail.targetId}`}
              </SiteLink>
            )
          ) : (
            (target.label ?? null) || caseTargetText(detail)
          )}
        </Field>
        {target.resource ? (
          <Field label="资源状态">
            {caseResourceStatusLabel(target.resource.status)}
          </Field>
        ) : null}
        {target.patch ? (
          <Field label="所属条目">
            <SiteLink href={`/${target.patch.uniqueId}`}>
              {target.patch.name || target.patch.uniqueId}
            </SiteLink>
          </Field>
        ) : null}
        {resourcePatch && resourcePatch.id !== target.patch?.id ? (
          <Field label="资源当前条目">
            <SiteLink href={`/${resourcePatch.uniqueId}`}>
              {resourcePatch.name || resourcePatch.uniqueId}
            </SiteLink>
          </Field>
        ) : null}
        {detail.targetType !== 'user' && content?.author ? (
          <Field label="作者">
            <UserLinks user={content.author} />
          </Field>
        ) : null}
        {content?.overall !== undefined ? (
          <Field label="评分">{`${content.overall} / 10`}</Field>
        ) : null}
      </dl>
      {detail.targetType !== 'user' && content?.text ? (
        <blockquote
          aria-label="被举报内容"
          className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap break-words"
        >
          {content.text}
        </blockquote>
      ) : null}
    </div>
  )
}

/**
 * Right-hand properties panel. It only restates fields the detail response
 * already carries; the module has no assignee, priority or SLA policy, so the
 * time rule is the documented hint from `caseStatusHint` and nothing else.
 */
export function CaseDetailProperties({ detail }: { detail: CaseDetail }) {
  const closed = detail.status === 'resolved' || detail.status === 'rejected'
  const resolutionLabel = caseResolutionLabel(detail.resolution)
  const statusHint = caseStatusHint(detail)
  // D24: offered by the server once the staff case waited 14 days on its reporter.
  const unresponsiveAllowed = detail.capabilities.allowedResolutions.includes(
    'reporter_unresponsive'
  )
  const timeFields: { label: string; value: string | null }[] = [
    { label: '创建时间', value: detail.created },
    { label: '进入当前状态', value: detail.statusChangedAt },
    { label: '升级时间', value: detail.escalatedAt },
    { label: '首次回应', value: detail.firstOwnerResponseAt },
    { label: '结案时间', value: detail.closedAt },
    { label: '隐藏时间', value: detail.hiddenAt },
    { label: '恢复时间', value: detail.restoredAt }
  ]

  return (
    <div className="space-y-4">
      <PanelSection title="事项属性">
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
          <Field label="状态">
            <Badge variant={CASE_STATUS_BADGE_VARIANTS[detail.status]}>
              {caseStatusLabel(detail.status)}
            </Badge>
          </Field>
          <Field label="类型">{caseKindLabel(detail.kind)}</Field>
          <Field label="处理方">
            {detail.ownerType === 'publisher'
              ? `发布者${detail.owner ? `（${detail.owner.name}）` : ''}`
              : '站方'}
          </Field>
          <Field label="开启者">
            {detail.reporter ? <UserLinks user={detail.reporter} /> : '报告者'}
          </Field>
          {detail.subscriberCount !== null ? (
            <Field label="报告人数">
              {detail.subscriberCount} 人（含关注者）
            </Field>
          ) : null}
          {detail.reopenedCount > 0 ? (
            <Field label="重开次数">{detail.reopenedCount}</Field>
          ) : null}
          {resolutionLabel ? (
            // Reopened and reviewed cases keep the last round's resolution
            // (plan 5.4); while open it is history, not the outcome.
            <Field label={closed ? '结论' : '上次结论'}>
              <Badge variant="outline">{resolutionLabel}</Badge>
            </Field>
          ) : null}
        </dl>
      </PanelSection>

      {statusHint ? (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {statusHint}
            {unresponsiveAllowed
              ? '；已满 14 天，可以以「开启者未回应」结案'
              : ''}
          </span>
        </p>
      ) : null}

      <PanelSection title="目标">
        <TargetBlock detail={detail} />
      </PanelSection>

      {detail.relatedOpenCaseIds?.length ? (
        <PanelSection title="同一条目的其他未结事项">
          <p className="text-xs text-muted-foreground">
            以下列出 {detail.relatedOpenCaseIds.length} 条同类未结事项（最多 20
            条），改完条目后可逐条打开结案：
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {detail.relatedOpenCaseIds.map((id) => (
              <li key={id}>
                <Link
                  href={`/dashboard/case/${id}`}
                  className="text-primary tabular-nums underline-offset-4 hover:underline"
                >
                  #{id}
                </Link>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <PanelSection title="时间">
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
          {timeFields.map((field) =>
            field.value ? (
              <Field key={field.label} label={field.label}>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatChinaDateTime(field.value)}
                </span>
              </Field>
            ) : null
          )}
        </dl>
      </PanelSection>
    </div>
  )
}
