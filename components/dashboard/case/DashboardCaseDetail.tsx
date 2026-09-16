'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2 } from 'lucide-react'

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
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Input } from '~/components/dashboard/ui/input'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { InboxDetailSkeleton } from '~/components/dashboard/inbox/InboxDetailSkeleton'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_QUICK_REPLIES,
  CASE_RESOLUTION_LABELS
} from '~/constants/case'
import {
  caseKindLabel,
  caseResolutionLabel,
  caseStatusLabel,
  caseTargetText
} from '~/components/case/caseDisplay'
import type {
  CaseActionResponse,
  CaseContentActionResponse,
  CaseDetail,
  CaseDetailResponse,
  CaseResolution,
  CaseResourceActionResponse
} from '~/types/api/case'
import type { CaseContentAction } from '~/constants/case'

import { CASE_STATUS_BADGE_VARIANTS } from './caseBadges'
import { CaseConversation } from './CaseConversation'
import { CaseDetailProperties } from './CaseDetailProperties'

/** 驳回态结论：走 handle 的 reject 动作，其余结论走 resolve。 */
const REJECT_RESOLUTIONS: ReadonlySet<CaseResolution> = new Set([
  'not_established',
  'out_of_scope'
])

type PendingAction =
  | { type: 'resolve'; resolution: CaseResolution }
  | { type: 'resource'; action: 'hide' | 'restore' | 'move' }
  | { type: 'content'; action: CaseContentAction }

interface DashboardCaseDetailProps {
  caseId: number
  /** 收件箱上下文：终结动作成功后回调（父组件从列表移除该项）。 */
  onProcessed?: () => void
  /** 收件箱上下文：非终结动作（回复）成功后回调，用于刷新列表行。 */
  onStateChanged?: () => void
}

/** 前台可打开的目标页；目标已删除或没有对应页面时不给入口。 */
const targetHref = (detail: CaseDetail): string | null => {
  if (detail.target.deleted) return null
  if (detail.targetType === 'user') return `/user/${detail.targetId}`
  const patch = detail.target.resource?.patch ?? detail.target.patch
  return patch ? `/${patch.uniqueId}` : null
}

export function DashboardCaseDetail({
  caseId,
  onProcessed,
  onStateChanged
}: DashboardCaseDetailProps) {
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [replyContent, setReplyContent] = useState('')
  const [resolution, setResolution] = useState<CaseResolution | ''>('')
  const [actionContent, setActionContent] = useState('')
  const [moveTargetPatchId, setMoveTargetPatchId] = useState('')
  const [handledUserConfirmed, setHandledUserConfirmed] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  // 退出动画期间保留呈现动作，不参与写入条件
  const [displayAction, setDisplayAction] = useState<PendingAction | null>(null)
  const [actionError, setActionError] = useState('')
  const [working, setWorking] = useState(false)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const lockRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setLoadError('')
    try {
      const res = await kunFetchGet<CaseDetailResponse | string>(
        `/case/${caseId}`
      )
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof res === 'string') {
        setDetail(null)
        setLoadError(res || '详情加载失败，请稍后重试')
      } else {
        setDetail(res.case)
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setDetail(null)
      setLoadError('网络错误，请检查网络连接后重试')
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [caseId])

  useEffect(() => {
    void load()
  }, [load])

  // 换一条事项时清空本地表单状态
  useEffect(() => {
    setReplyContent('')
    setResolution('')
    setActionContent('')
    setMoveTargetPatchId('')
    setHandledUserConfirmed(false)
    setPendingAction(null)
    setDisplayAction(null)
    setActionError('')
    triggerRef.current = null
  }, [caseId])

  const handleReply = async () => {
    const content = replyContent.trim()
    if (!content || lockRef.current) return
    lockRef.current = true
    setWorking(true)
    setActionError('')
    try {
      const res = await kunFetchPost<CaseActionResponse | string>(
        `/admin/case/${caseId}/handle`,
        { action: 'reply', content }
      )
      if (typeof res === 'string') {
        setActionError(res || '回复失败，请稍后重试')
        return
      }
      setReplyContent('')
      await load()
      onStateChanged?.()
    } catch {
      // 网络失败保留输入
      setActionError('网络错误，回复未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  const isUserTargetHandled =
    detail?.targetType === 'user' && resolution === 'handled'

  const openConfirm = (action: PendingAction, trigger: HTMLButtonElement) => {
    if (lockRef.current || pendingAction !== null) return
    setActionError('')

    if (action.type === 'resolve') {
      if (!action.resolution) {
        setActionError('请先选择处理结论')
        return
      }
      const trimmed = actionContent.trim()
      if (REJECT_RESOLUTIONS.has(action.resolution) && !trimmed) {
        setActionError('以该结论结案需要填写理由')
        return
      }
      if (isUserTargetHandled) {
        if (!handledUserConfirmed) {
          setActionError('请先确认已在用户管理完成对该用户的处置')
          return
        }
        if (!trimmed) {
          setActionError('请填写处理说明')
          return
        }
      }
    }
    if (action.type === 'resource' && action.action === 'move') {
      const targetId = Number(moveTargetPatchId)
      if (!Number.isSafeInteger(targetId) || targetId < 1) {
        setActionError('请输入正确的目标条目 ID')
        return
      }
      if (detail && detail.target.resource?.patchId === targetId) {
        setActionError('目标条目与当前条目相同')
        return
      }
    }

    triggerRef.current = trigger
    setDisplayAction(action)
    setPendingAction(action)
  }

  const runAction = async (action: PendingAction) => {
    if (lockRef.current) return
    lockRef.current = true
    setWorking(true)
    setActionError('')

    let succeeded = false
    let terminal = false
    try {
      let res: CaseActionResponse | string
      if (action.type === 'resolve') {
        const trimmed = actionContent.trim()
        terminal = true
        res = await kunFetchPost<CaseActionResponse | string>(
          `/admin/case/${caseId}/handle`,
          {
            action: REJECT_RESOLUTIONS.has(action.resolution)
              ? 'reject'
              : 'resolve',
            resolution: action.resolution,
            ...(trimmed ? { content: trimmed } : {}),
            ...(action.resolution === 'handled' && detail?.targetType === 'user'
              ? { handledUserConfirmed: true }
              : {})
          }
        )
      } else if (action.type === 'resource') {
        terminal = action.action !== 'restore'
        res = await kunFetchPost<CaseResourceActionResponse | string>(
          `/admin/case/${caseId}/resource`,
          {
            action: action.action,
            ...(action.action === 'move'
              ? { targetPatchId: Number(moveTargetPatchId) }
              : {}),
            ...(actionContent.trim() ? { content: actionContent.trim() } : {})
          }
        )
      } else {
        terminal = true
        res = await kunFetchPost<CaseContentActionResponse | string>(
          `/admin/case/${caseId}/content`,
          {
            action: action.action,
            ...(actionContent.trim() ? { content: actionContent.trim() } : {})
          }
        )
      }

      if (typeof res === 'string') {
        // 业务失败（含条件更新冲突）保留输入，并刷新以呈现最新状态
        setActionError(res || '操作失败，请稍后重试')
        onStateChanged?.()
        return
      }
      succeeded = true
    } catch {
      setActionError('网络错误，操作未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }

    if (!succeeded) return
    triggerRef.current = null
    setPendingAction(null)
    setActionContent('')
    setResolution('')
    setMoveTargetPatchId('')
    setHandledUserConfirmed(false)
    if (terminal) {
      onProcessed?.()
    } else if (action.type === 'resource' && action.action === 'restore') {
      onStateChanged?.()
    }
    await load()
  }

  // 无 Trigger 的受控 AlertDialog 关闭时显式恢复焦点到发起按钮
  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    const trigger = triggerRef.current
    triggerRef.current = null
    if (trigger && trigger.isConnected && !trigger.disabled) {
      trigger.focus()
    }
  }

  if (loading && !detail) {
    return <InboxDetailSkeleton label="正在加载事项详情" />
  }

  if (!detail) {
    return (
      <div className="space-y-3" aria-label="事项详情加载失败">
        <p role="alert" className="text-sm text-destructive">
          {loadError || '无法查看该事项'}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          重试
        </Button>
      </div>
    )
  }

  const { capabilities } = detail
  const currentResolutionLabel = caseResolutionLabel(detail.resolution)
  const resolutionOptions = capabilities.allowedResolutions.filter(
    (value) =>
      !(
        detail.targetType === 'user' &&
        value === 'handled' &&
        !capabilities.canConfirmUserHandled
      )
  )
  const href = targetHref(detail)
  const hasAdjudication =
    capabilities.canResolve ||
    capabilities.canHideResource ||
    capabilities.canRestoreResource ||
    capabilities.canMoveResource ||
    capabilities.canHandleContent

  // 内容处置动作完全由服务端按目标当前状态给出，前端不自行推导
  const contentActionMeta = (
    action: CaseContentAction
  ): { label: string; description: string; destructive: boolean } => {
    if (action === 'delete') {
      return {
        label: `删除被举报${detail.targetType === 'rating' ? '评价' : '评论'}`,
        description: '将删除被举报内容并以「已处理」结案，举报人会收到通知。',
        destructive: true
      }
    }
    if (action === 'takedown') {
      return {
        label: '下架小喇叭',
        description:
          '将按小喇叭既有规则下架该内容并以「已处理」结案，举报人会收到通知。',
        destructive: true
      }
    }
    return {
      label: '恢复小喇叭',
      description:
        '将把该小喇叭按误判恢复（含既有退款规则）并以「不成立」结案，举报人会收到通知。',
      destructive: false
    }
  }

  const displayActionText = (action: PendingAction | null): string => {
    if (!action) return ''
    if (action.type === 'resolve') {
      return `确认结案（${CASE_RESOLUTION_LABELS[action.resolution]}）`
    }
    if (action.type === 'resource') {
      return action.action === 'hide'
        ? '确认隐藏资源'
        : action.action === 'restore'
          ? '确认恢复资源'
          : '确认移动资源'
    }
    return `确认${contentActionMeta(action.action).label}`
  }

  const displayActionDescription = (action: PendingAction | null): string => {
    if (!action) return ''
    if (action.type === 'resolve') {
      if (action.resolution === 'handled' && detail.targetType === 'user') {
        return '将登记「已处理」并结案。请确认已在用户管理完成对该用户的实际处置，处理说明会通知举报人。'
      }
      return `将以「${CASE_RESOLUTION_LABELS[action.resolution]}」结案，报告者与关注者会收到通知。`
    }
    if (action.type === 'resource') {
      if (action.action === 'hide') {
        return '隐藏后该资源在前台不再出现，发布者会收到通知；事项随之结案。'
      }
      if (action.action === 'restore') {
        return '仅当该隐藏由本事项造成且尚未恢复过时才能恢复；恢复后发布者会收到通知。'
      }
      return '将把资源移动到目标条目并以「已移动」结案，资源与下载授权身份不变。'
    }
    return contentActionMeta(action.action).description
  }

  return (
    <div className="@container space-y-4">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            #{detail.id}
          </span>
          <h3 className="min-w-0 break-words text-base font-semibold">
            {caseTargetText(detail)}
          </h3>
          <Badge variant={CASE_STATUS_BADGE_VARIANTS[detail.status]}>
            {caseStatusLabel(detail.status)}
          </Badge>
          {currentResolutionLabel ? (
            <Badge variant="outline">{currentResolutionLabel}</Badge>
          ) : null}
          {href ? (
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <a href={href} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" aria-hidden />
                查看目标
              </a>
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {caseKindLabel(detail.kind)} ·{' '}
          {detail.ownerType === 'publisher' ? '发布者处理' : '站方处理'}
        </p>
      </header>

      <div className="grid min-w-0 gap-6 @[40rem]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-4">
          <section className="space-y-2" aria-label="沟通记录">
            <h4 className="text-sm font-semibold">沟通记录</h4>
            {/*
              The admin detail is never anonymized (the server identifies
              reporters here), so a null author can only be a deleted
              account — never an anonymized one.
            */}
            <CaseConversation messages={detail.messages} identifiesReporter />
          </section>

          {capabilities.canReply ? (
            <section className="space-y-2" aria-label="回复">
              <h4 className="text-sm font-semibold">回复</h4>
              <div className="flex flex-wrap gap-2">
                {CASE_QUICK_REPLIES.map((reply) => (
                  <Button
                    key={reply.code}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => setReplyContent(reply.content)}
                  >
                    {reply.label}
                  </Button>
                ))}
              </div>
              <Textarea
                aria-label="回复内容"
                value={replyContent}
                onChange={(event) => setReplyContent(event.target.value)}
                maxLength={CASE_CONTENT_MAX_LENGTH}
                rows={3}
                disabled={working}
                placeholder="回复报告者（纯文字）"
              />
              <div className="flex items-center justify-end gap-3">
                {actionError && pendingAction === null ? (
                  <p role="alert" className="text-sm text-destructive">
                    {actionError}
                  </p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={!replyContent.trim() || working}
                  onClick={() => void handleReply()}
                >
                  发送回复
                </Button>
              </div>
            </section>
          ) : null}

          {hasAdjudication ? (
            <section
              className="space-y-3 rounded-md border p-3"
              aria-label="裁决操作"
            >
              <h4 className="text-sm font-semibold">裁决操作</h4>

              {capabilities.canResolve ? (
                <div className="space-y-2">
                  <label
                    htmlFor="case-resolution"
                    className="text-sm font-medium"
                  >
                    处理结论
                  </label>
                  <Select
                    value={resolution}
                    onValueChange={(value) =>
                      setResolution(value as CaseResolution)
                    }
                    disabled={working}
                  >
                    <SelectTrigger id="case-resolution">
                      <SelectValue placeholder="请选择处理结论" />
                    </SelectTrigger>
                    <SelectContent>
                      {resolutionOptions.map((value) => (
                        <SelectItem key={value} value={value}>
                          {CASE_RESOLUTION_LABELS[value] ?? value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {isUserTargetHandled ? (
                    <div className="space-y-2 rounded-md border border-dashed p-3">
                      <p className="text-sm text-muted-foreground">
                        用户举报须先在
                        <Link
                          href="/dashboard/user"
                          className="mx-1 text-primary underline-offset-4 hover:underline"
                        >
                          用户管理
                        </Link>
                        完成实际处置，再回这里登记结论。
                      </p>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="case-handled-user-confirmed"
                          checked={handledUserConfirmed}
                          onCheckedChange={(checked) =>
                            setHandledUserConfirmed(checked === true)
                          }
                          disabled={working}
                        />
                        <label
                          htmlFor="case-handled-user-confirmed"
                          className="text-sm"
                        >
                          我已在用户管理完成对该用户的处置
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <label
                    htmlFor="case-action-content"
                    className="text-sm font-medium"
                  >
                    处理说明
                    {isUserTargetHandled ||
                    (resolution &&
                      REJECT_RESOLUTIONS.has(resolution as CaseResolution))
                      ? '（必填）'
                      : '（可选）'}
                  </label>
                  <Textarea
                    id="case-action-content"
                    value={actionContent}
                    onChange={(event) => setActionContent(event.target.value)}
                    maxLength={CASE_CONTENT_MAX_LENGTH}
                    rows={3}
                    disabled={working}
                    placeholder="给报告者的说明（纯文字）"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!resolution || working}
                      onClick={(event) =>
                        openConfirm(
                          {
                            type: 'resolve',
                            resolution: resolution as CaseResolution
                          },
                          event.currentTarget
                        )
                      }
                    >
                      结案
                    </Button>
                  </div>
                </div>
              ) : null}

              {capabilities.canHideResource ||
              capabilities.canRestoreResource ||
              capabilities.canMoveResource ||
              capabilities.canHandleContent ? (
                <div className="flex flex-wrap items-center gap-2">
                  {capabilities.canHideResource ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={working}
                      onClick={(event) =>
                        openConfirm(
                          { type: 'resource', action: 'hide' },
                          event.currentTarget
                        )
                      }
                    >
                      隐藏资源
                    </Button>
                  ) : null}
                  {capabilities.canRestoreResource ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={working}
                      onClick={(event) =>
                        openConfirm(
                          { type: 'resource', action: 'restore' },
                          event.currentTarget
                        )
                      }
                    >
                      恢复资源
                    </Button>
                  ) : null}
                  {capabilities.allowedContentActions.map((action) => (
                    <Button
                      key={action}
                      type="button"
                      variant={
                        contentActionMeta(action).destructive
                          ? 'destructive'
                          : 'outline'
                      }
                      size="sm"
                      disabled={working}
                      onClick={(event) =>
                        openConfirm(
                          { type: 'content', action },
                          event.currentTarget
                        )
                      }
                    >
                      {contentActionMeta(action).label}
                    </Button>
                  ))}
                </div>
              ) : null}

              {capabilities.canMoveResource ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <label
                      htmlFor="case-move-target"
                      className="text-sm font-medium"
                    >
                      移动到条目 ID
                    </label>
                    <Input
                      id="case-move-target"
                      inputMode="numeric"
                      className="w-40"
                      value={moveTargetPatchId}
                      onChange={(event) =>
                        setMoveTargetPatchId(event.target.value)
                      }
                      disabled={working}
                      placeholder="目标条目 ID"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!moveTargetPatchId.trim() || working}
                    onClick={(event) =>
                      openConfirm(
                        { type: 'resource', action: 'move' },
                        event.currentTarget
                      )
                    }
                  >
                    移动并结案
                  </Button>
                </div>
              ) : null}

              {actionError && pendingAction === null ? (
                <p role="alert" className="text-sm text-destructive">
                  {actionError}
                </p>
              ) : null}
              {working ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  正在提交…
                </span>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="min-w-0" aria-label="事项属性面板">
          <CaseDetailProperties detail={detail} />
        </aside>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          // 取消 / Esc 关闭且零写入；确认写请求在飞期间禁止关闭
          if (!open && !working) setPendingAction(null)
        }}
      >
        <AlertDialogContent
          className="max-h-[85dvh] overflow-y-auto"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {displayActionText(displayAction)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {displayActionDescription(displayAction)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">处理对象</p>
            <p className="break-words">
              {caseTargetText(detail)}（事项 #{detail.id}）
            </p>
          </div>
          {actionContent.trim() ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">处理说明</p>
              <p className="whitespace-pre-wrap break-words">
                {actionContent.trim()}
              </p>
            </div>
          ) : null}
          {actionError && pendingAction !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>取消</AlertDialogCancel>
            <Button
              variant={
                (displayAction?.type === 'resource' &&
                  displayAction.action === 'hide') ||
                (displayAction?.type === 'content' &&
                  contentActionMeta(displayAction.action).destructive)
                  ? 'destructive'
                  : 'default'
              }
              disabled={working}
              onClick={() => {
                // 唯一写入口：仅确认按钮调用写函数（内部仍含 ref 锁）
                if (pendingAction !== null) void runAction(pendingAction)
              }}
            >
              {working ? '处理中…' : '确认'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
