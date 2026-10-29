'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

import type { InboxItem } from '~/types/api/inbox'
import { USER_ROLE_MAP } from '~/constants/user'
import { RESOURCE_SECTION_MAP } from '~/constants/resource'
import { kunFetchPut } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
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
import { ReviewLayout } from './ReviewLayout'

type ResourceInboxItem = Extract<InboxItem, { kind: 'resource-apply' }>

interface ResourceInboxDetailProps {
  item: ResourceInboxItem
  onProcessed: (key: string) => void
  onStateChanged: (key: string) => void
  /** Phone layout puts everything in page flow. */
  isPhone?: boolean
}

const MAX_DECLINE_REASON_LENGTH = 1007
/** Exact service strings meaning the item is no longer actionable and should be refreshed. */
const STATE_CHANGED_MESSAGES = ['当前资源状态无需审核', '该资源不存在']
const REQUEST_FALLBACK_MESSAGE = '操作失败，请稍后重试'

const mapLabel = (labelMap: Record<string, string>, value: string) =>
  labelMap[value] ?? value

export function ResourceInboxDetail({
  item,
  onProcessed,
  onStateChanged,
  isPhone = false
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

  const title = (
    <div className="flex items-start justify-between gap-2">
      <h3 className="min-w-0 break-all text-base font-semibold leading-snug">
        {resource.name || '未命名资源'}
      </h3>
      <Badge variant="secondary" className="shrink-0">
        {mapLabel(RESOURCE_SECTION_MAP, resource.section)}
      </Badge>
    </div>
  )

  const account = (
    <a
      href={`/user/${resource.user.id}`}
      className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-accent"
    >
      {resource.user.avatar ? (
        <img
          src={resource.user.avatar}
          alt=""
          className="size-7 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
          {(resource.user.name[0] ?? '?').toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {resource.user.name || `用户 ${resource.user.id}`}
        </span>
        <span className="block text-xs text-muted-foreground">
          #{resource.user.id} · 已发布 {resource.user.patchCount} 份资源
        </span>
      </span>
      <Badge
        variant={resource.user.role >= 3 ? 'secondary' : 'outline'}
        className="shrink-0"
      >
        {USER_ROLE_MAP[resource.user.role] ?? '用户'}
      </Badge>
    </a>
  )

  const facts = [
    { label: '上传', value: formatChinaDateTime(resource.created) },
    {
      label: '游戏',
      value: (
        <a
          href={gameHref}
          className="text-primary underline-offset-4 hover:underline"
        >
          {gameName}
        </a>
      )
    },
    {
      label: '链接',
      value: `${resource.links.length} 条，地址与提取码见预览`
    }
  ]

  const form = (
    <section className="flex flex-col gap-2.5" aria-label="审核操作">
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
        通过后资源直接发布；拒绝会永久删除该资源、全部下载链接及已上传的文件，不可恢复。两个动作都需要确认。「编辑后通过」在旧后台处理，需要超级管理员。
      </p>
    </section>
  )

  return (
    <>
      <ReviewLayout
        title={title}
        account={account}
        facts={facts}
        form={form}
        preview={<PreviewFrame fill src={previewSrc} title="资源前台预览" />}
        isPhone={isPhone}
      />
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
    </>
  )
}
