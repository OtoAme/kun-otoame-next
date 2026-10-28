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

const MAX_CONTENT_LENGTH = 10007

export function CommentEditDialog({
  commentId,
  onUpdated
}: {
  commentId: number
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)

  // The list only carries a 233-character plain-text preview, so editing
  // always starts from the full stored markdown.
  const openEditor = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await kunFetchGet<{ content: string } | string>(
        '/admin/comment/full',
        { commentId }
      )
      if (typeof res === 'string') {
        toast.error(res || '读取评论全文失败')
        return
      }
      setContent(res.content)
      setOpen(true)
    } catch {
      toast.error('网络错误，读取评论全文失败')
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (inflight.current) return
    const trimmed = content.trim()
    if (!trimmed) {
      setError('评论内容不能为空')
      return
    }
    inflight.current = true
    setSaving(true)
    setError(null)
    try {
      const res = await kunFetchPut<Record<string, unknown> | string>(
        '/admin/comment',
        { commentId, content: trimmed }
      )
      if (typeof res === 'string') {
        // Keep the dialog and the edited text so nothing typed is lost.
        setError(res || '保存失败，请稍后重试')
        return
      }
      toast.success('评论已更新')
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
            <DialogTitle>编辑评论 #{commentId}</DialogTitle>
            <DialogDescription>
              保存后会写入管理日志，原内容一并记录。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="评论内容"
            value={content}
            maxLength={MAX_CONTENT_LENGTH}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-48"
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {content.length} / {MAX_CONTENT_LENGTH}
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

/** Deletes one or more comments; replies to them are removed with them. */
export function CommentDeleteDialog({
  commentIds,
  label,
  onDeleted
}: {
  commentIds: number[]
  label: string
  onDeleted: (count: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const idsKey = commentIds.join(',')

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
    if (inflight.current || commentIds.length === 0) return
    const ids = [...commentIds]
    inflight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await kunFetchDelete<Record<string, unknown> | string>(
        '/admin/comment',
        ids.length === 1 ? { commentId: ids[0] } : { commentIds: ids.join(',') }
      )
      if (typeof res === 'string') {
        setError(res || '删除失败，请稍后重试')
        return
      }
      toast.success(
        ids.length === 1 ? '评论已删除' : `已删除 ${ids.length} 条评论`
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

  const count = commentIds.length
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
            {count === 1 ? '删除评论' : `删除 ${count} 条评论`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? `即将删除评论 #${commentIds[0]}。`
              : `即将删除已选择的 ${count} 条评论。`}
            这些评论下的回复会一并删除，操作不可撤销。
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
