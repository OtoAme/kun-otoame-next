'use client'

import { useRef, useState, type RefObject } from 'react'
import toast from 'react-hot-toast'
import { Loader2, X } from 'lucide-react'
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
  CompanyMergeDismissResponse,
  CompanyMergeSuggestion
} from '~/types/api/companyMerges'

interface DismissSuggestionDialogProps {
  suggestion: CompanyMergeSuggestion
  onDismissed: (id: number) => void
  /** Where focus goes once the dismissed row has taken the trigger with it. */
  fallbackFocusRef: RefObject<HTMLElement | null>
}

/**
 * Dismiss one queued suggestion. The dialog only records the decision: the
 * companies themselves are never touched, and the key stays suppressed until
 * someone reopens it by hand.
 */
export const DismissSuggestionDialog = ({
  suggestion,
  onDismissed,
  fallbackFocusRef
}: DismissSuggestionDialogProps) => {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 同步锁: await 之前先落 ref 锁, 防止连击重复提交
  const inflightRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // 驳回成功后本行会被移除, 触发按钮随之卸载; Radix 的默认回焦会落到
  // <body>。按钮还在就交还给它, 否则退到列表容器。
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
    // 驳回在途时锁定关闭 (含 X / Escape / 遮罩 / 取消)
    if (inflightRef.current) {
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setError(null)
    }
  }

  const handleDismiss = async () => {
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
      const res = await kunFetchPost<CompanyMergeDismissResponse | string>(
        '/admin/company-merges/dismiss',
        { id: targetId }
      )
      if (typeof res === 'string') {
        // kunFetch 约定: 任何字符串 (包括空串) 都是业务错误
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
      toast.success(`已驳回会社合并建议 #${targetId}`)
      setOpen(false)
      setError(null)
      onDismissed(targetId)
      return
    }

    if (businessError !== null) {
      setError(businessError.trim() || '驳回失败，请稍后重试')
      return
    }

    if (unknownFailure) {
      toast.error('网络异常，驳回结果未知，请刷新列表后核对')
      setError(
        '网络异常，驳回结果未知。请刷新列表确认该建议是否仍待处理，再决定是否重试。'
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
          aria-label={`驳回会社合并建议 #${suggestion.id}`}
          className="cursor-pointer"
        >
          <X />
          驳回
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
          <AlertDialogTitle>驳回这条合并建议</AlertDialogTitle>
          <AlertDialogDescription>
            建议 #{suggestion.id} 将被整组驳回。再检测时按这一组会社 id
            跳过，不会自动拆出其中几家的新建议。折叠键「
            {suggestion.foldedKey}
            」只是展示。会社数据不会被修改，也不会有任何合并发生。
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
            variant="destructive"
            onClick={handleDismiss}
            disabled={busy}
            className="cursor-pointer disabled:cursor-default"
          >
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '驳回中…' : '确认驳回'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
