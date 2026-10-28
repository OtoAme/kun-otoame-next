'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Pencil, Trash2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '~/components/dashboard/ui/alert-dialog'
import { Button } from '~/components/dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/dashboard/ui/dialog'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { kunFetchDelete, kunFetchGet, kunFetchPut } from '~/utils/kunFetch'

/**
 * Text records administrators edit and delete from the console (comments,
 * ratings). Each kind names its endpoints and request fields; the dialogs
 * own the confirmation, in-flight lock and error handling.
 */
export interface RecordKind {
  /** Noun shown in titles and toasts, e.g. 评论. */
  noun: string
  endpoint: string
  /** Endpoint returning the full stored text for editing. */
  fullEndpoint: string
  idField: string
  idsField: string
  /** Body and response field holding the editable text. */
  textField: string
  maxLength: number
  /** Extra sentence for the delete confirmation. */
  deleteNote: string
}

export const COMMENT_RECORD: RecordKind = {
  noun: '评论',
  endpoint: '/admin/comment',
  fullEndpoint: '/admin/comment/full',
  idField: 'commentId',
  idsField: 'targetIds',
  textField: 'content',
  maxLength: 10007,
  deleteNote: '这些评论下的回复会一并删除，操作不可撤销。'
}

export const RATING_RECORD: RecordKind = {
  noun: '评价',
  endpoint: '/admin/rating',
  fullEndpoint: '/admin/rating/full',
  idField: 'ratingId',
  idsField: 'ratingIds',
  textField: 'shortSummary',
  maxLength: 1314,
  deleteNote: '评价的点赞记录会一并删除，操作不可撤销。'
}

export function RecordEditDialog({
  kind,
  id,
  onUpdated
}: {
  kind: RecordKind
  id: number
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)

  // Lists only carry a 233-character preview, so editing always starts from
  // the full stored text.
  const openEditor = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await kunFetchGet<Record<string, string> | string>(
        kind.fullEndpoint,
        { [kind.idField]: id }
      )
      if (typeof res === 'string') {
        toast.error(res || `读取${kind.noun}全文失败`)
        return
      }
      setContent(res[kind.textField] ?? '')
      setOpen(true)
    } catch {
      toast.error(`网络错误，读取${kind.noun}全文失败`)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (inflight.current) return
    const trimmed = content.trim()
    if (!trimmed) {
      setError(`${kind.noun}内容不能为空`)
      return
    }
    inflight.current = true
    setSaving(true)
    setError(null)
    try {
      const res = await kunFetchPut<Record<string, unknown> | string>(
        kind.endpoint,
        { [kind.idField]: id, [kind.textField]: trimmed }
      )
      if (typeof res === 'string') {
        // Keep the dialog and the edited text so nothing typed is lost.
        setError(res || '保存失败，请稍后重试')
        return
      }
      toast.success(`${kind.noun}已更新`)
      setOpen(false)
      onUpdated()
    } catch {
      setError('网络错误，保存结果未知。请刷新列表核对后再决定是否重试。')
    } finally {
      inflight.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openEditor}
        disabled={loading}
      >
        {loading ? <Loader2 className="animate-spin" /> : <Pencil />}
        编辑
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!inflight.current) setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              编辑{kind.noun} #{id}
            </DialogTitle>
            <DialogDescription>
              保存后会写入管理日志，原内容一并记录。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={`${kind.noun}内容`}
            value={content}
            maxLength={kind.maxLength}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-48"
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {content.length} / {kind.maxLength}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Deletes one or more records after an explicit confirmation. */
export function RecordDeleteDialog({
  kind,
  ids: targetIds,
  label,
  onDeleted
}: {
  kind: RecordKind
  ids: number[]
  label: string
  onDeleted: (count: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const idsKey = targetIds.join(',')

  // A changed target closes the dialog so it can never confirm a different
  // set than the one it described.
  const shownKey = useRef(idsKey)
  useEffect(() => {
    if (shownKey.current === idsKey) return
    shownKey.current = idsKey
    if (!inflight.current) {
      setOpen(false)
      setError(null)
    }
  }, [idsKey])

  const confirm = async () => {
    if (inflight.current || targetIds.length === 0) return
    const ids = [...targetIds]
    inflight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await kunFetchDelete<Record<string, unknown> | string>(
        kind.endpoint,
        ids.length === 1
          ? { [kind.idField]: ids[0] }
          : { [kind.idsField]: ids.join(',') }
      )
      if (typeof res === 'string') {
        setError(res || '删除失败，请稍后重试')
        return
      }
      toast.success(
        ids.length === 1
          ? `${kind.noun}已删除`
          : `已删除 ${ids.length} 条${kind.noun}`
      )
      setOpen(false)
      onDeleted(ids.length)
    } catch {
      setError('网络错误，删除结果未知。请刷新列表核对后再决定是否重试。')
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }

  const count = targetIds.length
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (inflight.current) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={count === 0}>
          <Trash2 />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? `删除${kind.noun}` : `删除 ${count} 条${kind.noun}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? `即将删除${kind.noun} #${targetIds[0]}。`
              : `即将删除已选择的 ${count} 条${kind.noun}。`}
            {kind.deleteNote}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '删除中…' : '删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
