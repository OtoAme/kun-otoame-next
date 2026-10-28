'use client'

import { useRef, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

import { useDashboard } from '~/components/dashboard/DashboardShell'
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
import { Textarea } from '~/components/dashboard/ui/textarea'
import { kunFetchPost } from '~/utils/kunFetch'

/**
 * Handles one legacy record through its existing endpoint after explicit
 * confirmation. The endpoint refuses records that were already handled.
 */
export function ArchiveHandleDialog({
  trigger,
  title,
  description,
  replyLabel,
  endpoint,
  body,
  confirmLabel,
  destructive,
  success,
  onDone
}: {
  trigger: ReactNode
  title: string
  description: string
  replyLabel: string
  endpoint: string
  body: Record<string, unknown>
  confirmLabel: string
  destructive?: boolean
  success: string
  onDone: () => void
}) {
  const { refreshCounts } = useDashboard()
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)

  const confirm = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await kunFetchPost<Record<string, unknown> | string>(
        endpoint,
        { ...body, content: reply.trim() }
      )
      if (typeof res === 'string') {
        setError(res || '处理失败，请稍后重试')
        return
      }
      toast.success(success)
      setOpen(false)
      setReply('')
      onDone()
      void refreshCounts()
    } catch {
      setError('网络错误，结果未知。请刷新列表核对后再决定是否重试。')
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (inflight.current) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          aria-label={replyLabel}
          placeholder={`${replyLabel}（可选）`}
          value={reply}
          maxLength={5000}
          onChange={(event) => setReply(event.target.value)}
          className="min-h-24"
        />
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
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={confirm}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
