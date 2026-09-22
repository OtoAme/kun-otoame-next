'use client'

import { useRef, useState, type RefObject } from 'react'
import toast from 'react-hot-toast'
import { Loader2, RotateCcw } from 'lucide-react'
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
import { kunFetchPost } from '~/utils/kunFetch'
import type {
  CompanyMergeReopenResponse,
  CompanyMergeSuggestion
} from '~/types/api/companyMerges'

interface ReopenSuggestionDialogProps {
  suggestion: CompanyMergeSuggestion
  onReopened: (id: number) => void
  fallbackFocusRef: RefObject<HTMLElement | null>
}

/**
 * Put a dismissed suggestion back to pending on the same row. Companies are
 * not written. The next detect will refresh this key instead of skipping it.
 */
export const ReopenSuggestionDialog = ({
  suggestion,
  onReopened,
  fallbackFocusRef
}: ReopenSuggestionDialogProps) => {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const inflightRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    const trigger = triggerRef.current
    if (trigger && trigger.isConnected) {
      trigger.focus()
      return
    }
    fallbackFocusRef.current?.focus()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (inflightRef.current) {
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setError(null)
    }
  }

  const handleReopen = async () => {
    if (inflightRef.current) {
      return
    }

    const targetId = suggestion.id
    inflightRef.current = true
    setBusy(true)
    setError(null)

    let businessError: string | null = null
    let unknownFailure = false
    let succeeded = false
    try {
      const res = await kunFetchPost<CompanyMergeReopenResponse | string>(
        '/admin/company-merges/reopen',
        { id: targetId }
      )
      if (typeof res === 'string') {
        businessError = res
      } else {
        succeeded = true
      }
    } catch {
      unknownFailure = true
    } finally {
      inflightRef.current = false
      setBusy(false)
    }

    if (succeeded) {
      toast.success(`已重新打开会社合并建议 #${targetId}`)
      setOpen(false)
      setError(null)
      onReopened(targetId)
      return
    }

    if (businessError !== null) {
      setError(businessError.trim() || '重新打开失败，请稍后重试')
      return
    }

    if (unknownFailure) {
      toast.error('网络异常，重新打开结果未知，请刷新列表后核对')
      setError(
        '网络异常，重新打开结果未知。请刷新列表确认该建议是否仍为已驳回，再决定是否重试。'
      )
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          aria-label={`重新打开会社合并建议 #${suggestion.id}`}
          className="cursor-pointer"
        >
          <RotateCcw />
          重新打开
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (inflightRef.current) {
            event.preventDefault()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>重新打开这条合并建议</AlertDialogTitle>
          <AlertDialogDescription>
            建议 #{suggestion.id} 将回到待处理，并重新占用这一组会社 id。折叠键「
            {suggestion.foldedKey}
            」只是展示，不决定会不会跳过。若已有待处理的同一组会社，重新打开会失败，这一行仍保持已驳回。不会新建一行，也不会改动会社数据。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="cursor-pointer">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            onClick={handleReopen}
            disabled={busy}
            className="cursor-pointer disabled:cursor-default"
          >
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '重新打开中…' : '确认重新打开'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
