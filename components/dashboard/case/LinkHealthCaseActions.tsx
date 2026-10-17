'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { HeartPulse } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { kunFetchPost } from '~/utils/kunFetch'
import type { LinkHealthView } from '~/types/api/linkHealth'
import { isLinkConflictError } from '~/components/patch/resource/linkHealthDisplay'
import {
  linkBasisFromView,
  linkHealthActionConfirmText,
  linkHealthActionLabel,
  linkHealthActionRequest,
  readLinkHealthActionResponse,
  type LinkHealthPendingAction
} from '~/components/case/linkHealthActionFlow'
import {
  INVALID_LINK_CHECK_FEEDBACK,
  linkCheckFeedback
} from '~/components/case/linkCheckFeedback'

interface LinkHealthCaseActionsProps {
  linkHealth: LinkHealthView
  /** 动作提交成功后由调用方重读详情并刷新列表行。 */
  onChanged: () => void
}

/**
 * 链接类事项详情里的健康动作区（用户侧与站方侧共用）：动作完全由服务端
 * capabilities 驱动，核实/确认失效/争议裁决/手动检测都先确认再写，具名
 * 409 原样提示且绝不自动重试。不在客户端推断权限或健康词表。
 */
export function LinkHealthCaseActions({
  linkHealth,
  onChanged
}: LinkHealthCaseActionsProps) {
  const [pending, setPending] = useState<LinkHealthPendingAction | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const current = useRef(linkHealth)
  current.current = linkHealth
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const { capabilities } = linkHealth
  const ownerActions = [
    ...(capabilities.ownerActions.includes('verify')
      ? ([{ kind: 'verify' }] as const)
      : []),
    ...(capabilities.ownerActions.includes('confirm_broken')
      ? ([{ kind: 'confirm_broken' }] as const)
      : [])
  ]
  const hasAny =
    ownerActions.length > 0 ||
    capabilities.resolveActions.length > 0 ||
    capabilities.canCheck
  if (!hasAny) {
    return null
  }

  const handleConfirm = async () => {
    if (!pending || inFlight.current) return
    const isCurrent = () => mounted.current && current.current === linkHealth
    const basis = linkBasisFromView(linkHealth)
    inFlight.current = true
    setSubmitting(true)
    let accepted = false
    try {
      const { url, body } = linkHealthActionRequest(pending, basis)
      const raw = await kunFetchPost<unknown>(url, body)
      if (!isCurrent()) return
      if (typeof raw === 'string') {
        toast.error(raw || '操作失败，请稍后重试')
        if (isLinkConflictError(raw)) {
          setPending(null)
        }
        return
      }
      const res = readLinkHealthActionResponse(raw, basis)
      if (!res) {
        toast.error(INVALID_LINK_CHECK_FEEDBACK.message)
        return
      }
      const feedback =
        pending.kind === 'check'
          ? linkCheckFeedback(res)
          : { type: 'success' as const, message: '已提交' }
      if (feedback.type === 'info') toast(feedback.message)
      else toast[feedback.type](feedback.message)
      setPending(null)
      accepted = true
    } catch {
      if (isCurrent()) toast.error('网络错误，操作失败，请重试')
    } finally {
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
    if (accepted) onChanged()
  }

  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="链接处理">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HeartPulse className="size-4 text-muted-foreground" aria-hidden />
        链接处理
        <Badge variant="outline" className="text-xs">
          v{linkHealth.version}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {ownerActions.map((action) => (
          <Button
            key={action.kind}
            type="button"
            variant={action.kind === 'verify' ? 'outline' : 'destructive'}
            size="sm"
            onClick={() => setPending(action)}
          >
            {linkHealthActionLabel(action)}
          </Button>
        ))}
        {capabilities.resolveActions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === 'available' ? 'outline' : 'destructive'}
            size="sm"
            onClick={() => setPending({ kind: 'resolve', action })}
          >
            {linkHealthActionLabel({ kind: 'resolve', action })}
          </Button>
        ))}
        {capabilities.canCheck && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPending({ kind: 'check' })}
          >
            {linkHealthActionLabel({ kind: 'check' })}
          </Button>
        )}
      </div>

      {/*
        受控 open：提交期间 onOpenChange(false) 一律忽略（ESC/遮罩/外部点击
        都关不掉），取消与关闭都保持零写入；成功/显式动作后再放 pending。
      */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? linkHealthActionLabel(pending) : '确认操作'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? linkHealthActionConfirmText(pending) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                // Radix Action 默认同次点击关闭 Dialog：先拦截，按结果显式关
                event.preventDefault()
                void handleConfirm()
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
