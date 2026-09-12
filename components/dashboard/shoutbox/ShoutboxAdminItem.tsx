'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/dashboard/ui/dialog'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { getShoutboxStatusLabel } from '~/constants/shoutbox'
import type { ShoutboxLevel } from '~/constants/shoutbox'
import { kunFetchPost, kunFetchPut } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { normalizeShoutboxContent } from '~/utils/shoutboxContent'
import { notifyShoutboxPublicWrite } from '~/components/shoutbox/query/core'
import { useShoutboxQueryContextOrNull } from '~/components/shoutbox/query/ShoutboxQueryProvider'
import { toLocalDateTimeInput } from './ShoutboxOfficialForm'
import type {
  AdminShoutboxReviewItem,
  ShoutboxItem,
  ShoutboxModerationResolution
} from '~/types/api/shoutbox'

type ConfirmAction = 'end' | 'cancel' | 'hide' | 'remove' | 'restore'

const CONFIRM_META: Record<
  ConfirmAction,
  { title: string; description: string; confirm: string; destructive: boolean }
> = {
  end: {
    title: '提前结束官方消息',
    description:
      '这条官方消息的生效结束时间将提前到当前，之后它不再置顶，也不再显示全站横幅。',
    confirm: '确认结束',
    destructive: false
  },
  cancel: {
    title: '撤回官方消息',
    description:
      '这条官方消息将被撤回：退出所有展示位置，不再置顶或显示全站横幅，尚未到生效开始的也不会再生效；后台记录中状态显示为已撤回。',
    confirm: '确认撤回',
    destructive: true
  },
  hide: {
    title: '隐藏小喇叭',
    description:
      '这条消息将被暂时隐藏并等待复核，作者会收到通知；相关举报保持待办，直到给出结论。',
    confirm: '确认隐藏',
    destructive: false
  },
  remove: {
    title: '删除小喇叭',
    description:
      '这条消息将被删除且不再公开显示，作者与举报人都会收到通知；删除不退还萌萌点。',
    confirm: '确认删除',
    destructive: true
  },
  restore: {
    title: '恢复小喇叭',
    description:
      '这条消息将恢复公开显示，作者与举报人都会收到通知；首次恢复会向作者退回发布时实付的萌萌点，相关举报按驳回结案。',
    confirm: '确认恢复',
    destructive: false
  }
}

const getPendingReports = (item: ShoutboxItem | AdminShoutboxReviewItem) =>
  'pendingReports' in item ? item.pendingReports : undefined

interface Props {
  item: ShoutboxItem | AdminShoutboxReviewItem
  onChanged: () => void
}

/**
 * One admin shoutbox row. Official messages keep their edit / end / cancel
 * lifecycle; moderation actions are shown strictly by status: official only
 * resolve; status 2 only remove/restore; status 1 (author-deleted) only
 * resolve; a public user message can be hidden or removed, and resolved when
 * it has pending reports; status 3 can be restored. Every write is preceded
 * by an explicit confirmation dialog; cancelling never writes.
 */
export const ShoutboxAdminItem = ({ item, onChanged }: Props) => {
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState('')
  // pendingAction drives dialog visibility; displayAction keeps the content
  // stable through the Radix exit animation.
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
  const [displayAction, setDisplayAction] = useState<ConfirmAction>('end')
  const [editOpen, setEditOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const lockRef = useRef(false)
  const shoutboxQuery = useShoutboxQueryContextOrNull()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const editTriggerRef = useRef<HTMLButtonElement | null>(null)
  const resolveTriggerRef = useRef<HTMLButtonElement | null>(null)

  const pendingReports = getPendingReports(item)
  const hasPendingReports = (pendingReports?.length ?? 0) > 0

  const fromMs = item.effectiveFrom
    ? new Date(item.effectiveFrom).getTime()
    : NaN
  const toMs = item.effectiveTo ? new Date(item.effectiveTo).getTime() : NaN
  const now = Date.now()

  // Official lifecycle: end stays strictly active-only (from < now < to);
  // cancel covers every status-0 message whose window has not ended yet.
  const canEdit = item.official && item.status === 0
  const canEnd =
    item.official && item.status === 0 && fromMs < now && toMs > now
  const canCancel = item.official && item.status === 0 && toMs > now
  // Moderation visibility mirrors the server guards; the server re-checks
  // every condition and its error string is surfaced verbatim.
  const canHide = !item.official && item.status === 0
  const canRemove = !item.official && (item.status === 0 || item.status === 2)
  const canRestore = !item.official && (item.status === 2 || item.status === 3)
  const canResolve = item.status !== 2 && hasPendingReports

  const openConfirm = (action: ConfirmAction, trigger: HTMLButtonElement) => {
    if (lockRef.current || pendingAction !== null) {
      return
    }
    setActionError('')
    triggerRef.current = trigger
    setDisplayAction(action)
    setPendingAction(action)
  }

  // Triggerless controlled dialogs would drop focus onto <body>; hand it back
  // to the button that opened the dialog when it is still usable.
  const restoreFocus = (ref: RefObject<HTMLButtonElement | null>) => {
    const trigger = ref.current
    ref.current = null
    if (trigger && trigger.isConnected && !trigger.disabled) {
      trigger.focus()
    }
  }
  const handleConfirmCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    restoreFocus(triggerRef)
  }

  const runConfirm = async () => {
    if (pendingAction === null || lockRef.current) {
      return
    }
    const action = pendingAction
    lockRef.current = true
    setWorking(true)
    setActionError('')
    try {
      const result =
        action === 'end' || action === 'cancel'
          ? await kunFetchPut<string | Record<string, unknown>>(
              '/admin/shoutbox',
              { shoutboxId: item.id, action }
            )
          : await kunFetchPost<string | Record<string, unknown>>(
              '/admin/shoutbox/moderate',
              { shoutboxId: item.id, action }
            )
      if (typeof result === 'string') {
        setActionError(result || '操作失败，请稍后重试')
        return
      }
      toast.success('操作已完成')
      setPendingAction(null)
      void notifyShoutboxPublicWrite(shoutboxQuery)
      onChanged()
    } catch {
      setActionError('网络错误，操作未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  const meta = CONFIRM_META[displayAction]

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">#{item.id}</span>
        <Link
          href={`/user/${item.user.id}`}
          prefetch={false}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {item.user.name}
        </Link>
        {item.official && <Badge variant="secondary">官方</Badge>}
        {item.official && item.level === 'important' && <Badge>重要</Badge>}
        {item.status !== 0 && (
          <Badge
            variant={
              item.status === 3
                ? 'destructive'
                : item.status === 2
                  ? 'outline'
                  : 'secondary'
            }
          >
            {getShoutboxStatusLabel(item.status, item.official)}
          </Badge>
        )}
        <span className="ml-auto shrink-0">
          发布于 {formatChinaDateTime(item.created)}
          {item.editedAt ? ' · 已编辑' : ''}
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {item.patch && (
          <Link
            href={`/${item.patch.uniqueId}`}
            prefetch={false}
            className="text-primary underline-offset-4 hover:underline"
          >
            《{item.patch.name}》
          </Link>
        )}
        {item.link ? (
          <Link
            href={item.link}
            prefetch={false}
            className="text-primary underline-offset-4 hover:underline"
          >
            详情链接
          </Link>
        ) : null}
        {item.official && item.effectiveFrom && item.effectiveTo && (
          <span>
            生效区间 {formatChinaDateTime(item.effectiveFrom)} ~{' '}
            {formatChinaDateTime(item.effectiveTo)}
          </span>
        )}
        {!item.official && <span>实付 {item.cost} 点</span>}
        {!item.official && item.refundedAt && <span>已退款</span>}
        {item.hiddenAt && (
          <span>隐藏于 {formatChinaDateTime(item.hiddenAt)}</span>
        )}
      </div>

      {pendingReports !== undefined &&
        (pendingReports.length > 0 ? (
          <div className="space-y-1 rounded-md border border-dashed p-2">
            <p className="text-xs font-medium text-muted-foreground">
              待处理举报 {pendingReports.length} 条
            </p>
            <ul className="space-y-1">
              {pendingReports.map((report) => (
                <li key={report.id} className="text-xs">
                  <Link
                    href={`/user/${report.sender.id}`}
                    prefetch={false}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {report.sender.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {' '}
                    · {formatChinaDateTime(report.created)} ·{' '}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {report.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          item.status === 2 && (
            <p className="text-xs text-muted-foreground">
              站方主动隐藏，当前无待处理举报
            </p>
          )
        ))}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={(event) => {
              editTriggerRef.current = event.currentTarget
              setEditOpen(true)
            }}
          >
            编辑
          </Button>
        )}
        {canEnd && (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={(event) => openConfirm('end', event.currentTarget)}
          >
            提前结束
          </Button>
        )}
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={(event) => openConfirm('cancel', event.currentTarget)}
          >
            撤回
          </Button>
        )}
        {canHide && (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={(event) => openConfirm('hide', event.currentTarget)}
          >
            暂时隐藏
          </Button>
        )}
        {canRemove && (
          <Button
            variant="destructive"
            size="sm"
            disabled={working}
            onClick={(event) => openConfirm('remove', event.currentTarget)}
          >
            删除
          </Button>
        )}
        {canRestore && (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={(event) => openConfirm('restore', event.currentTarget)}
          >
            恢复公开
          </Button>
        )}
        {canResolve && (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={(event) => {
              resolveTriggerRef.current = event.currentTarget
              setResolveOpen(true)
            }}
          >
            举报结案
          </Button>
        )}
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          // Cancelling never writes; a request in flight locks every close path.
          if (!open && !working) {
            setPendingAction(null)
          }
        }}
      >
        <AlertDialogContent onCloseAutoFocus={handleConfirmCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{meta.title}</AlertDialogTitle>
            <AlertDialogDescription>{meta.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {item.content}
          </p>
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>取消</AlertDialogCancel>
            <Button
              variant={meta.destructive ? 'destructive' : 'default'}
              disabled={working}
              onClick={() => void runConfirm()}
            >
              {working ? '处理中…' : meta.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canEdit && (
        <ShoutboxOfficialEditDialog
          item={item}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            setEditOpen(false)
            onChanged()
          }}
          triggerRef={editTriggerRef}
        />
      )}
      {canResolve && (
        <ShoutboxResolveDialog
          item={item}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          onResolved={() => {
            setResolveOpen(false)
            onChanged()
          }}
          triggerRef={resolveTriggerRef}
        />
      )}
    </div>
  )
}

interface OfficialEditDialogProps {
  item: ShoutboxItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

const ShoutboxOfficialEditDialog = ({
  item,
  open,
  onOpenChange,
  onSaved,
  triggerRef
}: OfficialEditDialogProps) => {
  const [content, setContent] = useState(() =>
    normalizeShoutboxContent(item.content)
  )
  const [level, setLevel] = useState<ShoutboxLevel>(item.level)
  const [effectiveFrom, setEffectiveFrom] = useState(
    item.effectiveFrom ? toLocalDateTimeInput(new Date(item.effectiveFrom)) : ''
  )
  const [effectiveTo, setEffectiveTo] = useState(
    item.effectiveTo ? toLocalDateTimeInput(new Date(item.effectiveTo)) : ''
  )
  const [link, setLink] = useState(item.link)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lockRef = useRef(false)
  const shoutboxQuery = useShoutboxQueryContextOrNull()

  // Re-initialize from the current item on every open so an abandoned draft
  // never survives a cancel.
  useEffect(() => {
    if (!open) {
      return
    }
    setContent(normalizeShoutboxContent(item.content))
    setLevel(item.level)
    setEffectiveFrom(
      item.effectiveFrom
        ? toLocalDateTimeInput(new Date(item.effectiveFrom))
        : ''
    )
    setEffectiveTo(
      item.effectiveTo ? toLocalDateTimeInput(new Date(item.effectiveTo)) : ''
    )
    setLink(item.link)
    setError('')
  }, [open, item])

  const handleOpenChange = (next: boolean) => {
    // In-flight saves lock every close path (X / Esc / overlay).
    if (!next && lockRef.current) {
      return
    }
    onOpenChange(next)
  }

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    const trigger = triggerRef.current
    triggerRef.current = null
    if (trigger && trigger.isConnected && !trigger.disabled) {
      trigger.focus()
    }
  }

  const handleSave = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      setError('官方消息正文不能为空')
      return
    }
    if (trimmed.length > 200) {
      setError('官方消息正文不能超过 200 个字符')
      return
    }
    const fromDate = new Date(effectiveFrom)
    const toDate = new Date(effectiveTo)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      setError('请填写有效的生效起止时间')
      return
    }
    if (toDate.getTime() <= fromDate.getTime()) {
      setError('生效结束时间必须晚于开始时间')
      return
    }
    if (lockRef.current) {
      return
    }
    lockRef.current = true
    setSaving(true)
    setError('')
    try {
      const result = await kunFetchPut<string | Record<string, unknown>>(
        '/admin/shoutbox',
        {
          shoutboxId: item.id,
          content: trimmed,
          level,
          effectiveFrom: fromDate.toISOString(),
          effectiveTo: toDate.toISOString(),
          link: link.trim()
        }
      )
      if (typeof result === 'string') {
        setError(result || '保存失败，请稍后重试')
        return
      }
      toast.success('官方消息已更新')
      void notifyShoutboxPublicWrite(shoutboxQuery)
      onSaved()
    } catch {
      setError('网络错误，保存未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>编辑官方消息 #{item.id}</DialogTitle>
          <DialogDescription>
            官方消息不受 5 分钟编辑限制，正文、级别与生效区间随时可改。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            aria-label="官方消息正文"
            value={content}
            onChange={(event) =>
              setContent(normalizeShoutboxContent(event.target.value))
            }
            maxLength={200}
            disabled={saving}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={level}
              onValueChange={(value) => setLevel(value as ShoutboxLevel)}
              disabled={saving}
            >
              <SelectTrigger className="w-[140px]" aria-label="消息级别">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">普通级</SelectItem>
                <SelectItem value="important">重要级（全站横幅）</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              生效开始
              <Input
                type="datetime-local"
                aria-label="生效开始时间"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                disabled={saving}
                className="w-auto"
              />
            </label>
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              生效结束
              <Input
                type="datetime-local"
                aria-label="生效结束时间"
                value={effectiveTo}
                onChange={(event) => setEffectiveTo(event.target.value)}
                disabled={saving}
                className="w-auto"
              />
            </label>
          </div>
          <Input
            aria-label="详情链接"
            placeholder="详情链接（可选，站内文档路径）"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={saving}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ResolveDialogProps {
  item: ShoutboxItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolved: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

const ShoutboxResolveDialog = ({
  item,
  open,
  onOpenChange,
  onResolved,
  triggerRef
}: ResolveDialogProps) => {
  const [resolution, setResolution] = useState<
    '' | ShoutboxModerationResolution
  >('')
  const [content, setContent] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const lockRef = useRef(false)
  const shoutboxQuery = useShoutboxQueryContextOrNull()

  // Same reset-on-open discipline as the official edit dialog.
  useEffect(() => {
    if (!open) {
      return
    }
    setResolution('')
    setContent('')
    setError('')
  }, [open])

  const handleOpenChange = (next: boolean) => {
    if (!next && lockRef.current) {
      return
    }
    onOpenChange(next)
  }

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    const trigger = triggerRef.current
    triggerRef.current = null
    if (trigger && trigger.isConnected && !trigger.disabled) {
      trigger.focus()
    }
  }

  const handleSubmit = async () => {
    if (!resolution) {
      setError('请选择结案结论')
      return
    }
    if (lockRef.current) {
      return
    }
    lockRef.current = true
    setWorking(true)
    setError('')
    try {
      const result = await kunFetchPost<string | Record<string, unknown>>(
        '/admin/shoutbox/moderate',
        {
          shoutboxId: item.id,
          action: 'resolve',
          resolution,
          content: content.trim()
        }
      )
      if (typeof result === 'string') {
        setError(result || '结案失败，请稍后重试')
        return
      }
      toast.success('举报已结案')
      void notifyShoutboxPublicWrite(shoutboxQuery)
      onResolved()
    } catch {
      setError('网络错误，结案未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>举报结案 · 小喇叭 #{item.id}</DialogTitle>
          <DialogDescription>
            只给这条消息的待处理举报下结论并通知举报人，不改变消息状态；隐藏中的消息需要先恢复或删除。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select
            value={resolution}
            onValueChange={(value) =>
              setResolution(value as ShoutboxModerationResolution)
            }
            disabled={working}
          >
            <SelectTrigger aria-label="结案结论" className="w-full">
              <SelectValue placeholder="选择结案结论" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="accept">受理（举报成立）</SelectItem>
              <SelectItem value="reject">驳回（举报不成立）</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            aria-label="结案说明"
            placeholder="结案说明（可选，随通知发出）"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={5000}
            disabled={working}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={working}
          >
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={working}>
            {working ? '提交中…' : '提交结案'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
