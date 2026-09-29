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
import { IssueImageField } from '~/components/dashboard/issue/IssueImageField'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_QUICK_REPLIES,
  CASE_RESOLUTION_LABELS,
  caseQuickRepliesFor
} from '~/constants/case'
import {
  caseClosingNoteError,
  caseKindLabel,
  caseLatestProposal,
  caseResolutionLabel,
  caseReviewRequested,
  caseStatusLabel,
  caseTargetHref,
  caseTargetText
} from '~/components/case/caseDisplay'
import { useCaseImageUploads } from '~/components/case/useCaseImageUploads'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type {
  AdminCaseMessageHideResponse,
  CaseActionResponse,
  CaseContentActionResponse,
  CaseDetail,
  CaseDetailResponse,
  CaseMessage,
  CaseMessageResponse,
  CaseResolution,
  CaseResourceActionResponse,
  CaseSummary
} from '~/types/api/case'
import type { CaseContentAction } from '~/constants/case'

import { CASE_STATUS_BADGE_VARIANTS } from './caseBadges'
import { CaseConversation } from './CaseConversation'
import {
  CaseDetailProperties,
  userManagementHref
} from './CaseDetailProperties'
import { CaseMovePatchSearch } from './CaseMovePatchSearch'

/** 驳回态结论：走 handle 的 reject 动作，其余结论走 resolve。 */
const REJECT_RESOLUTIONS: ReadonlySet<CaseResolution> = new Set([
  'not_established',
  'out_of_scope',
  'declined'
])

const OUT_OF_SCOPE_TEMPLATE =
  CASE_QUICK_REPLIES.find((reply) => reply.code === 'out_of_scope')?.content ??
  ''

type PendingAction =
  | { type: 'resolve'; resolution: CaseResolution }
  // 采纳原发布者的提请（D20）：以提请的结论结案，提请说明作为结案说明
  | { type: 'adopt'; resolution: CaseResolution; note: string }
  | { type: 'resource'; action: 'hide' | 'restore' | 'move' }
  | { type: 'content'; action: CaseContentAction }
  // 隐藏或取消隐藏一条对话（D27），不改事项状态
  | { type: 'hide-message'; message: CaseMessage; hidden: boolean }

interface DashboardCaseDetailProps {
  caseId: number
  /** 收件箱上下文：终结动作成功后回调（父组件从列表移除该项）。 */
  onProcessed?: () => void
  /**
   * 非终结动作（回复、恢复资源、隐藏对话）或业务失败后回调，用于刷新列表行。
   * 回复成功时带上服务端返回的最新摘要，收件箱据此判断事项是否已离开队列。
   */
  onStateChanged?: (updated?: CaseSummary) => void
}

const isTerminal = (action: PendingAction) =>
  action.type === 'resolve' ||
  action.type === 'adopt' ||
  action.type === 'content' ||
  (action.type === 'resource' && action.action !== 'restore')

export function DashboardCaseDetail({
  caseId,
  onProcessed,
  onStateChanged
}: DashboardCaseDetailProps) {
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [replyContent, setReplyContent] = useState('')
  const replyUploads = useCaseImageUploads()
  // D28：默认交给报告者补充；取消勾选则事项留在待处理原位。
  // D32：仍归发布者的事项里站方介入默认不交给报告者，发布者的 7 天照常计时。
  const handOverByDefault = detail?.ownerType !== 'publisher'
  const [awaitReporter, setAwaitReporter] = useState(true)
  const [resolution, setResolution] = useState<CaseResolution | ''>('')
  const [actionContent, setActionContent] = useState('')
  const [moveTargetPatchId, setMoveTargetPatchId] = useState('')
  const [moveTargetName, setMoveTargetName] = useState('')
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
  const resetReplyUploads = replyUploads.reset
  useEffect(() => {
    setReplyContent('')
    resetReplyUploads()
    setAwaitReporter(true)
    setResolution('')
    setActionContent('')
    setMoveTargetPatchId('')
    setMoveTargetName('')
    setHandledUserConfirmed(false)
    setPendingAction(null)
    setDisplayAction(null)
    setActionError('')
    triggerRef.current = null
  }, [caseId, resetReplyUploads])

  // 归属读到之后才知道默认该不该交给报告者
  useEffect(() => {
    setAwaitReporter(handOverByDefault)
  }, [caseId, handOverByDefault])

  const handleReply = async () => {
    const content = replyContent.trim()
    if (!content || replyUploads.uploading || lockRef.current) return
    lockRef.current = true
    setWorking(true)
    setActionError('')
    try {
      const res = await kunFetchPost<CaseMessageResponse | string>(
        `/admin/case/${caseId}/handle`,
        {
          action: 'reply',
          content,
          ...(replyUploads.keys.length ? { imageKeys: replyUploads.keys } : {}),
          ...(awaitReporter ? {} : { awaitReporter: false })
        }
      )
      if (typeof res === 'string') {
        // 业务失败（含已被他人结案）保留草稿，原地重读以呈现最新状态
        setActionError(res || '回复失败，请稍后重试')
        void load()
        return
      }
      setReplyContent('')
      replyUploads.reset()
      setAwaitReporter(handOverByDefault)
      await load()
      onStateChanged?.(res.case)
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
      const noteError = detail
        ? caseClosingNoteError(detail, action.resolution, trimmed)
        : null
      if (noteError) {
        setActionError(noteError)
        return
      }
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
    const terminal = isTerminal(action)
    try {
      let res: CaseActionResponse | AdminCaseMessageHideResponse | string
      if (action.type === 'adopt') {
        res = await kunFetchPost<CaseActionResponse | string>(
          `/admin/case/${caseId}/handle`,
          {
            action: REJECT_RESOLUTIONS.has(action.resolution)
              ? 'reject'
              : 'resolve',
            resolution: action.resolution,
            ...(action.note ? { content: action.note } : {})
          }
        )
      } else if (action.type === 'resolve') {
        const trimmed = actionContent.trim()
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
      } else if (action.type === 'hide-message') {
        res = await kunFetchPost<AdminCaseMessageHideResponse | string>(
          `/admin/case/${caseId}/message-hide`,
          { messageId: action.message.id, hidden: action.hidden }
        )
      } else {
        res = await kunFetchPost<CaseContentActionResponse | string>(
          `/admin/case/${caseId}/content`,
          {
            action: action.action,
            ...(actionContent.trim() ? { content: actionContent.trim() } : {})
          }
        )
      }

      if (typeof res === 'string') {
        // 业务失败（含条件更新冲突）保留输入与确认框；详情原地重读以呈现最新状态，
        // 列表由调用方刷新
        setActionError(res || '操作失败，请稍后重试')
        onStateChanged?.()
        void load()
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
    if (action.type !== 'hide-message') {
      setActionContent('')
      setResolution('')
      setMoveTargetPatchId('')
      setMoveTargetName('')
      setHandledUserConfirmed(false)
    }
    if (terminal) {
      onProcessed?.()
    } else {
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
      // Centered like every other state panel in the queue, so a missing case
      // does not render as a fragment pinned to the corner of a wide pane.
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        aria-label="事项详情加载失败"
      >
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
  const closed = detail.status === 'resolved' || detail.status === 'rejected'
  // 重开与复核保留上一轮结论（实施计划 5.4），未结时不当作当前结论（审阅第 6 条）
  const currentResolutionLabel = closed
    ? caseResolutionLabel(detail.resolution)
    : null
  const resolutionOptions = capabilities.allowedResolutions.filter(
    (value) =>
      !(
        detail.targetType === 'user' &&
        value === 'handled' &&
        !capabilities.canConfirmUserHandled
      )
  )
  const href = caseTargetHref(detail, { forAdmin: true })
  const proposal = capabilities.canResolve
    ? caseLatestProposal(detail.messages, detail.reporter?.id)
    : null
  const reviewRequested =
    detail.ownerType === 'staff' && caseReviewRequested(detail.messages)
  // D16 与重开一次的规则：复核结论和重开过的事项，站方结案后不能再重开或复核
  const finalNotice = reviewRequested
    ? '这是复核结论：结案后报告者不能再重开或申请复核。'
    : detail.reopenedCount >= 1
      ? '这条问题已重开过：结案后报告者不能再重开或申请复核。'
      : ''
  const noteRule = resolution
    ? caseClosingNoteError(detail, resolution, '')
    : null
  const dialogNote =
    displayAction?.type === 'adopt'
      ? displayAction.note
      : displayAction?.type === 'hide-message'
        ? ''
        : actionContent.trim()
  const hasAdjudication =
    capabilities.canResolve ||
    capabilities.canHideResource ||
    capabilities.canRestoreResource ||
    capabilities.canMoveResource ||
    capabilities.canHandleContent
  const quickReplies = caseQuickRepliesFor(detail.kind)
  // 审阅第 23 条：写明这条回复谁看得到
  const handedOff =
    detail.ownerType === 'staff' && detail.public && detail.escalatedAt !== null
  const replyAudience =
    detail.ownerType === 'publisher'
      ? '报告者与发布者都能看到这条回复'
      : handedOff
        ? '报告者与原发布者都能看到这条回复'
        : '报告者能看到这条回复'
  // 只有轮到处理方时，回复才会把事项交给报告者（D28）
  const canHandOver =
    detail.reporter !== null &&
    detail.reporter !== undefined &&
    (detail.status === 'open' || detail.status === 'waiting_owner')
  const targetContent = detail.target.content

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
    if (action.type === 'adopt') {
      return `采纳提请（${CASE_RESOLUTION_LABELS[action.resolution]}）`
    }
    if (action.type === 'hide-message') {
      return action.hidden ? '确认隐藏这条对话' : '确认取消隐藏'
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

  const baseActionDescription = (action: PendingAction): string => {
    if (action.type === 'resolve') {
      if (action.resolution === 'handled' && detail.targetType === 'user') {
        return '将登记「已处理」并结案。请确认已在用户管理完成对该用户的实际处置，处理说明会通知举报人。'
      }
      if (action.resolution === 'reporter_unresponsive') {
        return '报告者已满 14 天没有补充，将以「开启者未回应」结案；关注者会收到可以重新提交的说明。'
      }
      return `将以「${CASE_RESOLUTION_LABELS[action.resolution]}」结案，报告者与关注者会收到通知。`
    }
    if (action.type === 'adopt') {
      return `将以原发布者提请的「${CASE_RESOLUTION_LABELS[action.resolution]}」结案，提请说明作为结案说明通知报告者与关注者。`
    }
    if (action.type === 'hide-message') {
      return action.hidden
        ? '隐藏后，除网站管理员外的所有人只看到「该内容已被网站管理员隐藏。」，附图也不再显示；原文保留，可以取消隐藏。已经发出的通知摘要不会收回。'
        : '取消后，能查看对话的人会重新看到这条内容与附图。'
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

  const displayActionDescription = (action: PendingAction | null): string => {
    if (!action) return ''
    const base = baseActionDescription(action)
    return isTerminal(action) && finalNotice ? `${base}${finalNotice}` : base
  }

  const toggleHidden = (message: CaseMessage, trigger: HTMLButtonElement) =>
    openConfirm(
      { type: 'hide-message', message, hidden: !message.hidden },
      trigger
    )

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
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {caseKindLabel(detail.kind)} ·{' '}
            {detail.ownerType === 'publisher' ? '发布者处理' : '站方处理'}
          </span>
          {/* D16: the site administrator's closure here is final. */}
          {reviewRequested ? (
            <Badge variant="secondary">报告者申请复核</Badge>
          ) : null}
        </p>
      </header>

      {/* 失败后重读发现事项已被他人结案时，回复区与裁决区都不再渲染，原因改在这里显示 */}
      {actionError &&
      pendingAction === null &&
      !capabilities.canReply &&
      !hasAdjudication ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 @[40rem]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-4">
          {proposal ? (
            <section
              aria-label="原发布者的提请"
              className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  原发布者提请以「
                  {CASE_RESOLUTION_LABELS[proposal.resolution] ??
                    proposal.resolution}
                  」结案
                </h4>
                <Button
                  type="button"
                  size="sm"
                  disabled={working}
                  onClick={(event) =>
                    openConfirm(
                      {
                        type: 'adopt',
                        resolution: proposal.resolution,
                        note: proposal.note
                      },
                      event.currentTarget
                    )
                  }
                >
                  采纳
                </Button>
              </div>
              {proposal.note ? (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {proposal.note}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                提请于 {formatChinaDateTime(proposal.created)}
                。不采纳时直接回复说明即可，回复后这条提请会收起。
              </p>
            </section>
          ) : null}

          <section className="space-y-2" aria-label="沟通记录">
            <h4 className="text-sm font-semibold">沟通记录</h4>
            {/*
              The admin detail is never anonymized (the server identifies
              reporters here), so a null author can only be a deleted
              account — never an anonymized one.
            */}
            <CaseConversation
              messages={detail.messages}
              reporterId={detail.reporter?.id}
              identifiesReporter
              onToggleHidden={
                capabilities.canHideMessages ? toggleHidden : undefined
              }
              actionsDisabled={working}
            />
          </section>

          {capabilities.canReply ? (
            <section className="space-y-2" aria-label="回复">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold">回复</h4>
                <p className="text-xs text-muted-foreground">{replyAudience}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickReplies.map((reply) => (
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
                placeholder="回复内容（纯文字，可以附图）"
              />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <IssueImageField uploads={replyUploads} disabled={working} />
                <div className="flex flex-col items-end gap-2">
                  {canHandOver ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="case-reply-await-reporter"
                        checked={awaitReporter}
                        onCheckedChange={(checked) =>
                          setAwaitReporter(checked === true)
                        }
                        disabled={working}
                      />
                      <label
                        htmlFor="case-reply-await-reporter"
                        className="text-sm"
                      >
                        回复后等待报告者补充
                      </label>
                    </div>
                  ) : null}
                  {canHandOver && !awaitReporter ? (
                    <p className="text-xs text-muted-foreground">
                      {detail.ownerType === 'publisher'
                        ? '事项仍等发布者处理，发布者的 7 天时限照常计时。'
                        : '事项仍留在待处理，不交给报告者。'}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-3">
                    {actionError && pendingAction === null ? (
                      <p role="alert" className="text-sm text-destructive">
                        {actionError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        !replyContent.trim() ||
                        working ||
                        replyUploads.uploading
                      }
                      onClick={() => void handleReply()}
                    >
                      发送回复
                    </Button>
                  </div>
                </div>
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
                          href={userManagementHref(detail.targetId)}
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
                    noteRule ||
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
                    placeholder="给报告者的说明（纯文字；需要配图请先回复）"
                  />
                  {noteRule ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {noteRule}
                      </p>
                      {resolution === 'out_of_scope' &&
                      OUT_OF_SCOPE_TEMPLATE &&
                      !(
                        detail.kind === 'other' && detail.targetType === 'site'
                      ) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={working}
                          onClick={() =>
                            setActionContent(OUT_OF_SCOPE_TEMPLATE)
                          }
                        >
                          填入指南模板
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
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
                <div className="space-y-3">
                  <CaseMovePatchSearch
                    disabled={working}
                    excludePatchId={detail.target.resource?.patchId}
                    onPick={(patch) => {
                      setMoveTargetPatchId(String(patch.id))
                      setMoveTargetName(patch.name)
                    }}
                  />
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor="case-move-target"
                        className="text-sm font-medium"
                      >
                        或直接填写条目 ID
                      </label>
                      <Input
                        id="case-move-target"
                        inputMode="numeric"
                        className="w-40"
                        value={moveTargetPatchId}
                        onChange={(event) => {
                          setMoveTargetPatchId(event.target.value)
                          setMoveTargetName('')
                        }}
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
                  {moveTargetName ? (
                    <p className="text-xs text-muted-foreground">
                      已选择：{moveTargetName}（条目 #{moveTargetPatchId}）
                    </p>
                  ) : null}
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
          {displayAction?.type === 'hide-message' ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">对话内容</p>
              <p className="line-clamp-4 whitespace-pre-wrap break-words">
                {displayAction.message.body}
              </p>
            </div>
          ) : targetContent ? (
            // 审阅第 3 条：确认删除、下架或结案前看得到被举报的内容本身
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                {detail.targetType === 'user' ? '被举报用户' : '被举报内容'}
                {targetContent.author ? `（${targetContent.author.name}）` : ''}
              </p>
              {targetContent.text ? (
                <p className="line-clamp-6 whitespace-pre-wrap break-words">
                  {targetContent.text}
                </p>
              ) : null}
            </div>
          ) : null}
          {displayAction?.type === 'resource' &&
          displayAction.action === 'move' ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">移动到</p>
              <p className="break-words">
                {moveTargetName
                  ? `${moveTargetName}（条目 #${moveTargetPatchId}）`
                  : `条目 #${moveTargetPatchId}`}
              </p>
            </div>
          ) : null}
          {dialogNote ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">处理说明</p>
              <p className="whitespace-pre-wrap break-words">{dialogNote}</p>
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
                (displayAction?.type === 'hide-message' &&
                  displayAction.hidden) ||
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
