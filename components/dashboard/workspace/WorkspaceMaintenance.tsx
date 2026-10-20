'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  LINK_MAINTENANCE_NOTE_MAX,
  LINK_MAINTENANCE_SNOOZE_DAYS
} from '~/constants/linkMaintenance'
import {
  WORKSPACE_MAINTENANCE_VIEWS,
  WORKSPACE_PAGE_LIMIT,
  WORKSPACE_SECTIONS
} from '~/constants/workspace'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_RESOURCE_LINK_MAP
} from '~/constants/resource'
import { LINK_HEALTH_LABELS } from '~/components/patch/resource/linkHealthDisplay'
import type {
  LinkMaintenanceAction,
  LinkMaintenanceItem,
  LinkMaintenanceState
} from '~/types/api/linkMaintenance'
import type {
  WorkspaceMaintenanceView,
  WorkspaceSection
} from '~/types/api/workspace'
import type { LinkMaintenanceListResponse } from '~/types/api/linkMaintenance'
import {
  workspaceIssueHref,
  workspaceResourceHref
} from '~/utils/workspaceRoutes'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'

const VIEW_LABEL: Record<WorkspaceMaintenanceView, string> = {
  feedback: '用户反馈',
  optional: '可选处理',
  handled: '已处理'
}

const STATE_LABEL: Record<LinkMaintenanceState, string> = {
  pending: '待处理',
  snoozed: '已暂缓',
  optional: '可选处理',
  handled: '已处理',
  stopped: '已停止维护'
}

const ACTION_LABEL: Record<LinkMaintenanceAction, string> = {
  respond: '回应',
  verify: '核实可用',
  snooze: '暂缓',
  stop: '停止维护',
  resume: '恢复维护'
}

const ACTION_CONFIRM: Record<LinkMaintenanceAction, string> = {
  respond: '提交后这一轮结束，说明会发给可以查看的人。',
  verify:
    '确认这条链接现在可以打开。同一版本 30 天内只能核实一次，这一轮会结束。',
  snooze:
    '暂停 1 天或 3 天。暂停期间不会发出处理结果。到期后这条维护会回到待处理，重新读取即可查看最新状态。',
  stop: '不再维护这个地址。当前版本会被冻结。',
  resume: '解除冻结。已有的处理记录保留。'
}

type PendingAction = {
  item: LinkMaintenanceItem
  action: LinkMaintenanceAction
  note: string
  days: 1 | 3
}

export function WorkspaceMaintenance() {
  const [view, setView] = useState<WorkspaceMaintenanceView>('feedback')
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [section, setSection] = useState<WorkspaceSection>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<LinkMaintenanceListResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const generationRef = useRef(0)
  const rereadFor = useRef(new Set<string>())

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    try {
      const response = await kunFetchGet<LinkMaintenanceListResponse | string>(
        '/workspace/maintenance',
        {
          view,
          page,
          limit: WORKSPACE_PAGE_LIMIT,
          section,
          ...(submittedQuery ? { query: submittedQuery } : {})
        }
      )
      if (generation !== generationRef.current) return
      if (typeof response === 'string') {
        setError(response || '加载维护清单失败')
        return
      }
      setData(response)
    } catch {
      if (generation !== generationRef.current) return
      setError('网络错误，维护清单加载失败，请重试')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [page, section, submittedQuery, view, reloadKey])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const expired = (data?.items ?? []).filter(
      (item) =>
        item.state === 'snoozed' &&
        Boolean(item.snoozedUntil) &&
        Date.parse(item.snoozedUntil ?? '') <= Date.now()
    )
    if (expired.length === 0) return
    let scheduled = false
    for (const item of expired) {
      const key = [
        view,
        page,
        section,
        submittedQuery,
        item.linkId,
        item.linkVersion,
        item.snoozedUntil
      ].join(':')
      if (rereadFor.current.has(key)) continue
      rereadFor.current.add(key)
      scheduled = true
    }
    if (scheduled) setReloadKey((current) => current + 1)
  }, [data, page, section, submittedQuery, view])

  const pages = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / (data?.limit ?? WORKSPACE_PAGE_LIMIT))
  )

  return (
    <section className="min-w-0 space-y-3" aria-label="链接维护">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">链接维护</h2>
        <p className="text-sm text-muted-foreground">
          {typeof data?.actionableCount === 'number'
            ? `待处理 ${data.actionableCount}。`
            : ''}
          暂缓到期后回到待处理，重新读取即可查看最新状态。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {WORKSPACE_MAINTENANCE_VIEWS.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={view === value ? 'default' : 'outline'}
            onClick={() => {
              setView(value)
              setPage(1)
            }}
          >
            {VIEW_LABEL[value]}
          </Button>
        ))}
      </div>
      <form
        className="flex min-w-0 flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setSubmittedQuery(query.trim())
        }}
      >
        <Input
          aria-label="搜索维护项"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 w-full sm:w-64"
          placeholder="游戏或资源"
        />
        <div className="flex items-center gap-2 text-sm">
          <span>分区</span>
          <Select
            value={section}
            onValueChange={(value) => {
              setSection(value as WorkspaceSection)
              setPage(1)
            }}
          >
            <SelectTrigger aria-label="维护分区" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKSPACE_SECTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === 'all' ? '全部分区' : RESOURCE_SECTION_MAP[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          搜索
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReloadKey((current) => current + 1)}
        >
          重新读取
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading && !data ? <p className="text-sm">正在加载维护清单…</p> : null}
      <ul className="grid min-w-0 gap-3">
        {(data?.items ?? []).map((item) => (
          <li
            key={`${item.linkId}:${item.linkVersion}:${item.maintenanceRevision}`}
          >
            <WorkspaceMaintenanceCard
              item={item}
              onChanged={() => setReloadKey((current) => current + 1)}
            />
          </li>
        ))}
      </ul>
      {data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">这个清单里没有链接。</p>
      ) : null}
      {pages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {pages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export function WorkspaceMaintenanceCard({
  item,
  onChanged,
  embedded = false
}: {
  item: LinkMaintenanceItem
  onChanged: () => void
  /** Inside the resource editor: only this link's maintenance, no title/self link. */
  embedded?: boolean
}) {
  const [note, setNote] = useState('')
  const [days, setDays] = useState<1 | 3>(1)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const expired =
    item.state === 'snoozed' &&
    Boolean(item.snoozedUntil) &&
    Date.parse(item.snoozedUntil ?? '') <= Date.now()
  const needsNote =
    pending?.action === 'respond' ||
    pending?.action === 'verify' ||
    pending?.action === 'stop'

  const confirm = async () => {
    if (!pending || submitting) return
    if (needsNote && !pending.note.trim()) {
      setMessage('请填写说明')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      const body = maintenanceBody(pending)
      const response = await kunFetchPost<
        string | { item: LinkMaintenanceItem }
      >('/workspace/maintenance', body)
      if (typeof response === 'string') {
        setMessage(response || '操作失败，请稍后重试')
        return
      }
      setPending(null)
      setNote('')
      onChanged()
    } catch {
      setMessage('网络错误，操作失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        {!embedded ? (
          <CardTitle className="break-all text-base">
            {item.patch.name} · {item.resource.name}
          </CardTitle>
        ) : null}
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{STATE_LABEL[item.state]}</Badge>
          <span>{LINK_HEALTH_LABELS[item.health.health]}</span>
          <span className="break-all">
            {SUPPORTED_RESOURCE_LINK_MAP[item.storage] ?? item.storage}
          </span>
          {item.snoozedUntil ? (
            <span className="break-all">暂缓至 {item.snoozedUntil}</span>
          ) : null}
          {expired ? <span>暂缓已到期，回到待处理，请重新读取。</span> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.response?.note ? (
          <p className="break-all text-sm">{item.response.note}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!embedded ? (
            <Button asChild size="sm" variant="outline">
              <Link href={workspaceResourceHref(item.resourceId, item.linkId)}>
                打开资源
              </Link>
            </Button>
          ) : null}
          {item.caseId ? (
            <Button asChild size="sm" variant="outline">
              <Link href={workspaceIssueHref(item.caseId)}>关联事项</Link>
            </Button>
          ) : null}
          {expired ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onChanged}
            >
              重新读取
            </Button>
          ) : null}
        </div>
        {item.capabilities.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {item.capabilities.actions.map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setMessage('')
                  setPending({ item, action, note, days })
                }}
              >
                {ACTION_LABEL[action]}
              </Button>
            ))}
          </div>
        ) : null}
        {message && pending === null ? (
          <p role="alert" className="break-all text-sm text-destructive">
            {message}
          </p>
        ) : null}
      </CardContent>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            if (pending) {
              setNote(pending.note)
              setDays(pending.days)
            }
            setPending(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? ACTION_LABEL[pending.action] : '确认操作'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? ACTION_CONFIRM[pending.action] : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending &&
          (pending.action === 'respond' ||
            pending.action === 'verify' ||
            pending.action === 'stop') ? (
            <Textarea
              aria-label="维护说明"
              value={pending.note}
              maxLength={LINK_MAINTENANCE_NOTE_MAX}
              onChange={(event) =>
                setPending({ ...pending, note: event.target.value })
              }
              placeholder="回应、核实或停止维护时需要说明"
              className="min-w-0 break-all"
            />
          ) : null}
          {pending?.action === 'snooze' ? (
            <div className="grid gap-1 text-sm">
              <span>暂缓</span>
              <Select
                value={String(pending.days)}
                onValueChange={(value) =>
                  setPending({
                    ...pending,
                    days: Number(value) === 3 ? 3 : 1
                  })
                }
              >
                <SelectTrigger aria-label="暂缓天数" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_MAINTENANCE_SNOOZE_DAYS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} 天
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {message && pending ? (
            <p role="alert" className="break-all text-sm text-destructive">
              {message}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void confirm()}
            >
              {submitting ? '正在提交…' : '确认'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export function maintenanceBody(pending: PendingAction) {
  const target = {
    patchId: pending.item.patchId,
    resourceId: pending.item.resourceId,
    linkId: pending.item.linkId,
    linkVersion: pending.item.linkVersion,
    maintenanceRevision: pending.item.maintenanceRevision
  }
  if (pending.action === 'respond' || pending.action === 'stop') {
    return { ...target, action: pending.action, note: pending.note.trim() }
  }
  if (pending.action === 'verify') {
    return {
      ...target,
      action: 'verify' as const,
      note: pending.note.trim(),
      basis: {
        patchId: pending.item.patchId,
        resourceId: pending.item.resourceId,
        linkId: pending.item.linkId,
        linkVersion: pending.item.linkVersion,
        evidenceRound: pending.item.health.evidenceRound,
        health: pending.item.health.health,
        healthChangedAt: pending.item.health.healthChangedAt
      }
    }
  }
  if (pending.action === 'snooze') {
    return { ...target, action: 'snooze' as const, days: pending.days }
  }
  return { ...target, action: 'resume' as const }
}
