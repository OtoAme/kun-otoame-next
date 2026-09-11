'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

import type { InboxItem } from '~/types/api/inbox'
import { USER_ROLE_MAP } from '~/constants/user'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_LINK_MAP,
  SUPPORTED_TYPE_MAP
} from '~/constants/resource'
import { kunFetchPut } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Separator } from '~/components/dashboard/ui/separator'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'

import { PreviewFrame } from './PreviewFrame'

type ResourceInboxItem = Extract<InboxItem, { kind: 'resource-apply' }>

interface ResourceInboxDetailProps {
  item: ResourceInboxItem
  onProcessed: (key: string) => void
  onStateChanged: (key: string) => void
}

const MAX_DECLINE_REASON_LENGTH = 1007
/** Exact service strings meaning the item is no longer actionable and should be refreshed. */
const STATE_CHANGED_MESSAGES = ['当前资源状态无需审核', '该资源不存在']
const REQUEST_FALLBACK_MESSAGE = '操作失败，请稍后重试'

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

/** Renders user-supplied URLs as links only for http/https or single-/ relative paths; anything else stays plain text. */
function SafeUrlValue({ value }: { value?: string | null }) {
  const url = (value ?? '').trim()
  if (!url) {
    return <EmptyValue />
  }
  if (isSafeExternalUrl(url) || isSafeRelativeUrl(url)) {
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
  return <span className="break-all">{url}</span>
}

function BadgeList({
  values,
  labelMap
}: {
  values: string[]
  labelMap: Record<string, string>
}) {
  if (!values || values.length === 0) {
    return <EmptyValue />
  }
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="outline">
          {labelMap[value] ?? value}
        </Badge>
      ))}
    </span>
  )
}

const mapLabel = (labelMap: Record<string, string>, value: string) =>
  labelMap[value] ?? value

export function ResourceInboxDetail({
  item,
  onProcessed,
  onStateChanged
}: ResourceInboxDetailProps) {
  const resource = item.payload
  const reasonId = useId()
  const reasonErrorId = `${reasonId}-error`

  const [pending, setPending] = useState(false)
  // Which review action is awaiting confirmation; null = dialog closed.
  const [confirmAction, setConfirmAction] = useState<
    'approve' | 'decline' | null
  >(null)
  // Presentation-only action: updated only when a new confirmation opens and
  // kept while Radix animates the closed DOM out, so exiting content never
  // flips to the other action. It never gates the writer.
  const [displayAction, setDisplayAction] = useState<'approve' | 'decline'>(
    'approve'
  )
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState('')

  // Synchronous duplicate-submit guard (state updates land too late).
  const inFlightRef = useRef(false)
  // Tracks which item is currently shown; updated during render so a late
  // response for a previous item never mutates the newly selected item's UI.
  const currentKeyRef = useRef(item.key)
  currentKeyRef.current = item.key
  // Local state must not be touched after unmount; business callbacks still fire.
  const mountedRef = useRef(true)
  // Focus restoration: the marker button that opened the confirmation and the
  // item key at that moment (this controlled dialog has no AlertDialogTrigger).
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const triggerKeyRef = useRef(item.key)
  // Set when the dialog closes after a successful write: the parent removes the
  // item and owns focus, so the stale trigger must not be refocused.
  const skipFocusRestoreRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    // Item identity change closes any stale confirmation for the previous item.
    inFlightRef.current = false
    setPending(false)
    setConfirmAction(null)
    setReason('')
    setActionError('')
    triggerRef.current = null
  }, [item.key])

  /** Returns { ok, message }; a string result is a business failure message. */
  const sendRequest = async (
    url: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const result = await kunFetchPut(url, body)
      if (typeof result === 'string') {
        return { ok: false, message: result || REQUEST_FALLBACK_MESSAGE }
      }
      return { ok: true, message: '' }
    } catch {
      return { ok: false, message: REQUEST_FALLBACK_MESSAGE }
    }
  }

  // Marker buttons (also clicked by the outer a/d keyboard layer) only open
  // the confirmation dialog; they never write. Re-entry while a dialog is
  // already open is ignored so outer shortcuts cannot stack dialogs.
  // Mouse clicks and the outer a/d layer's programmatic .click() share this
  // entry, so event.currentTarget is the reliable focus-restoration target
  // (document.activeElement is not set by programmatic clicks).
  const openApproveConfirm = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (pending || confirmAction) return
    triggerRef.current = event.currentTarget
    triggerKeyRef.current = item.key
    setActionError('')
    setDisplayAction('approve')
    setConfirmAction('approve')
  }

  const openDeclineConfirm = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (pending || confirmAction) return
    triggerRef.current = event.currentTarget
    triggerKeyRef.current = item.key
    setActionError('')
    setDisplayAction('decline')
    setConfirmAction('decline')
  }

  // The single writer for both review actions; only the confirm button calls it.
  const handleConfirm = async () => {
    const action = confirmAction
    if (!action) return
    const trimmedReason = reason.trim()
    if (action === 'decline') {
      if (!trimmedReason) {
        setActionError('请填写拒绝原因')
        return
      }
      if (trimmedReason.length > MAX_DECLINE_REASON_LENGTH) {
        setActionError(`拒绝原因不能超过 ${MAX_DECLINE_REASON_LENGTH} 字`)
        return
      }
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    setActionError('')
    const capturedKey = item.key
    const resourceId = item.id

    const result =
      action === 'approve'
        ? await sendRequest('/admin/resource-apply/approve', { resourceId })
        : await sendRequest('/admin/resource-apply/decline', {
            resourceId,
            reason: trimmedReason
          })

    const canTouchLocal =
      mountedRef.current && currentKeyRef.current === capturedKey
    if (canTouchLocal) {
      inFlightRef.current = false
      setPending(false)
    }

    // Callbacks run outside any try/catch and even after unmount/selection
    // change: the parent hook is still mounted and must remove the processed
    // item. A parent callback error must never surface as a failed action.
    if (result.ok) {
      toast.success(action === 'approve' ? '资源已通过' : '资源已拒绝并删除')
      if (canTouchLocal) {
        // The processed item is about to be removed by the parent; let the
        // inbox selection logic own focus instead of the stale trigger.
        skipFocusRestoreRef.current = true
        setConfirmAction(null)
      }
      onProcessed(capturedKey)
      return
    }
    // Keep the dialog open with the failure visible; the entered reason is retained.
    toast.error(result.message)
    if (canTouchLocal) {
      setActionError(result.message)
    }
    if (STATE_CHANGED_MESSAGES.includes(result.message)) {
      onStateChanged(capturedKey)
    }
  }

  const previewSrc = `/preview/resource/${item.id}`
  // item.targetHref is the public game page (/{uniqueId}) supplied by the inbox API.
  const gameHref = item.targetHref
  const gameName = resource.patchName || resource.uniqueId

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-lg font-semibold leading-tight">
            {resource.name || '未命名资源'}
          </h2>
          <Badge variant="secondary">资源申请</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          上传于 {formatChinaDateTime(resource.created)} · 所属游戏{' '}
          <a
            href={gameHref}
            className="text-primary underline-offset-4 hover:underline"
          >
            {gameName}
          </a>
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">基本信息</h3>
        <dl className="space-y-2">
          <Field label="资源名称">
            <TextValue value={resource.name} />
          </Field>
          <Field label="所属游戏">
            <a
              href={gameHref}
              className="break-all text-primary underline-offset-4 hover:underline"
            >
              {gameName}
            </a>
          </Field>
          <Field label="分区">
            {resource.section ? (
              <Badge variant="outline">
                {mapLabel(RESOURCE_SECTION_MAP, resource.section)}
              </Badge>
            ) : (
              <EmptyValue />
            )}
          </Field>
          <Field label="类型">
            <BadgeList values={resource.type} labelMap={SUPPORTED_TYPE_MAP} />
          </Field>
          <Field label="语言">
            <BadgeList
              values={resource.language}
              labelMap={SUPPORTED_LANGUAGE_MAP}
            />
          </Field>
          <Field label="平台">
            <BadgeList
              values={resource.platform}
              labelMap={SUPPORTED_PLATFORM_MAP}
            />
          </Field>
          <Field label="上传者">
            <span className="flex flex-wrap items-center gap-2">
              <a
                href={`/user/${resource.user.id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {resource.user.name || `用户 ${resource.user.id}`}
              </a>
              <Badge
                variant={resource.user.role >= 3 ? 'secondary' : 'outline'}
              >
                {USER_ROLE_MAP[resource.user.role] ?? '用户'}
              </Badge>
              <span className="text-muted-foreground">
                共发布 {resource.user.patchCount} 个资源
              </span>
            </span>
          </Field>
          <Field label="上传时间">
            {formatChinaDateTime(resource.created)}
          </Field>
        </dl>
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">资源备注</h3>
        {resource.note ? (
          <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">
            {resource.note}
          </p>
        ) : (
          <EmptyValue />
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          下载链接（{resource.links.length}）
        </h3>
        {resource.links.length === 0 ? (
          <EmptyValue />
        ) : (
          <ul className="space-y-3">
            {resource.links.map((link, index) => (
              <li key={link.id} className="rounded-md border p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  链接 {index + 1}
                </p>
                <dl className="space-y-2">
                  <Field label="存储">
                    <TextValue
                      value={
                        link.storage
                          ? mapLabel(SUPPORTED_RESOURCE_LINK_MAP, link.storage)
                          : link.storage
                      }
                    />
                  </Field>
                  <Field label="地址">
                    <SafeUrlValue value={link.content} />
                  </Field>
                  <Field label="大小">
                    <TextValue value={link.size} />
                  </Field>
                  <Field label="提取码">
                    <TextValue value={link.code} />
                  </Field>
                  <Field label="密码">
                    <TextValue value={link.password} />
                  </Field>
                  <Field label="Hash">
                    <TextValue value={link.hash} />
                  </Field>
                  <Field label="下载次数">
                    <TextValue value={link.download} />
                  </Field>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">前台预览</h3>
        <PreviewFrame src={previewSrc} title="资源前台预览" />
      </section>

      <Separator />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-inbox-action="positive"
            onClick={openApproveConfirm}
            disabled={pending}
          >
            通过
          </Button>
          <Button
            variant="destructive"
            data-inbox-action="destructive"
            onClick={openDeclineConfirm}
            disabled={pending}
          >
            拒绝并删除
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/resource-apply" prefetch={false}>
              编辑后通过
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          通过后资源将直接发布；拒绝会永久删除该资源、其全部下载链接及该资源已上传的文件，不可恢复。两个动作均需确认后才会生效。「编辑后通过」需前往旧后台处理，处理需超级管理员权限。
        </p>
      </section>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          // Cancel/Esc closes with zero writes; closing is blocked while a request runs.
          if (!open && !pending) {
            setConfirmAction(null)
            setActionError('')
          }
        }}
      >
        <AlertDialogContent
          className="max-h-[85vh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            // Controlled dialog without Trigger: Radix's default close focus
            // falls back to BODY, so restore the initiating button explicitly.
            event.preventDefault()
            const trigger = triggerRef.current
            triggerRef.current = null
            const skip = skipFocusRestoreRef.current
            skipFocusRestoreRef.current = false
            if (
              !skip &&
              trigger &&
              mountedRef.current &&
              trigger.isConnected &&
              !trigger.disabled &&
              triggerKeyRef.current === currentKeyRef.current
            ) {
              trigger.focus()
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {displayAction === 'approve'
                ? '确认通过该资源？'
                : '确认拒绝并删除该资源？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {displayAction === 'approve'
                ? `将通过资源「${resource.name || '未命名资源'}」（所属游戏 ${gameName}，共 ${resource.links.length} 条下载链接）。通过后资源将直接发布，操作立即生效。`
                : `将拒绝并永久删除资源「${resource.name || '未命名资源'}」、其全部 ${resource.links.length} 条下载链接及该资源已上传的文件，删除后不可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {displayAction === 'decline' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={reasonId} className="text-sm font-medium">
                  拒绝原因（必填，最多 {MAX_DECLINE_REASON_LENGTH} 字）
                </label>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {reason.length}/{MAX_DECLINE_REASON_LENGTH}
                </span>
              </div>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={MAX_DECLINE_REASON_LENGTH}
                rows={4}
                disabled={pending}
                placeholder="请说明拒绝原因，将反馈给上传者"
                aria-invalid={actionError ? true : undefined}
                aria-describedby={actionError ? reasonErrorId : undefined}
              />
              {actionError ? (
                <p
                  id={reasonErrorId}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {actionError}
                </p>
              ) : null}
            </div>
          ) : actionError ? (
            <p
              id={reasonErrorId}
              role="alert"
              className="text-sm text-destructive"
            >
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            {/* Plain Button (not AlertDialogAction) so a failed request keeps the dialog open with the error visible; this is the only writer. */}
            {displayAction === 'approve' ? (
              <Button onClick={handleConfirm} disabled={pending}>
                {pending ? '正在通过…' : '确认通过'}
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={pending}
              >
                {pending ? '正在删除…' : '确认删除'}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
