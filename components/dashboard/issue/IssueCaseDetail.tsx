'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  RotateCcw,
  Send,
  TriangleAlert,
  XCircle
} from 'lucide-react'
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
import { Card } from '~/components/dashboard/ui/card'
import { Separator } from '~/components/dashboard/ui/separator'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { useUserStore } from '~/store/userStore'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH,
  CASE_QUICK_REPLIES,
  CASE_REOPEN_WINDOW_MS,
  CASE_REPORT_MIN_LENGTH,
  CASE_RESOLUTION_LABELS,
  CASE_UNRESOLVED_STATUSES
} from '~/constants/case'
import {
  caseKindLabel,
  caseMessageAuthorLabel,
  caseMessageSide,
  caseResolutionLabel,
  caseStatusHint,
  caseStatusLabel,
  caseSystemEventText,
  caseTargetText,
  formatCaseDuration
} from '~/components/case/caseDisplay'
import { cn } from '~/lib/dashboard/utils'
import type {
  CaseActionResponse,
  CaseCreateResponse,
  CaseDetail,
  CaseDetailResponse,
  CaseMessage,
  CaseMessageResponse,
  CaseReopenResponse,
  CaseResolution,
  CaseStatus
} from '~/types/api/case'

const STATUS_BADGE_VARIANTS: Record<
  CaseStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  open: 'default',
  waiting_owner: 'default',
  waiting_reporter: 'secondary',
  resolved: 'outline',
  rejected: 'destructive',
  merged: 'outline'
}

interface IssueCaseDetailProps {
  caseId: number
  /** 工作区上下文：详情里的写操作改变了列表行时回调。 */
  onChanged?: () => void
}

/**
 * 会话时间轴。系统事件用分隔线呈现，回复按角色区分，两者都来自真实的
 * `detail.messages`——本系统的状态机是 open/waiting_owner ↔ waiting_reporter
 * 往复后才终结，没有单向阶段，所以这里不画阶段进度条。用户侧拿不到 payload
 * （服务端只给 admin 视角下发），系统事件文案走服务端合成的 body 与事件回退。
 */
function CaseTimeline({
  messages,
  reporterId,
  identifiesReporter,
  viewerId
}: {
  messages: CaseMessage[]
  reporterId: number | null | undefined
  /** 本视角是否有权识别报告者；决定 `author: null` 该读作脱敏还是注销账号。 */
  identifiesReporter: boolean
  viewerId: number
}) {
  return (
    <ol className="space-y-4" aria-label="沟通记录">
      {messages.map((message) => {
        const side = caseMessageSide(message, reporterId, identifiesReporter)
        if (side === 'system') {
          return (
            <li
              key={message.id}
              className="flex items-center gap-3 text-xs text-muted-foreground"
            >
              <Separator className="flex-1" />
              <span className="shrink-0 text-center">
                {caseSystemEventText(message)} ·{' '}
                {formatChinaDateTime(message.created)}
              </span>
              <Separator className="flex-1" />
            </li>
          )
        }
        const authorName = caseMessageAuthorLabel(message, identifiesReporter)
        const isViewer =
          message.author !== null && message.author.id === viewerId
        return (
          <li key={message.id} className="flex gap-3">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                side === 'owner'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
                // 注销账号：不偏向任何一侧，虚线圈与虚线气泡
                side === 'unknown' && 'border border-dashed bg-transparent'
              )}
            >
              {authorName.trim().slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {authorName}
                </span>
                {/* 注销账号无法判定属于哪一侧，不贴角色徽标而不是猜一个 */}
                {side === 'unknown' ? null : (
                  <Badge variant={side === 'owner' ? 'secondary' : 'outline'}>
                    {side === 'owner' ? '处理方' : '报告者'}
                  </Badge>
                )}
                {isViewer ? <span>（我）</span> : null}
                <span>{formatChinaDateTime(message.created)}</span>
              </span>
              <span
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap',
                  side === 'owner' ? 'bg-muted' : 'border',
                  side === 'unknown' && 'border-dashed'
                )}
              >
                {message.body}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function IssueCaseDetail({ caseId, onChanged }: IssueCaseDetailProps) {
  const router = useRouter()
  const { user } = useUserStore((state) => state)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [replyContent, setReplyContent] = useState('')
  const [replyError, setReplyError] = useState('')
  const [resolution, setResolution] = useState<CaseResolution | ''>('')
  const [resolveContent, setResolveContent] = useState('')
  const [pendingAction, setPendingAction] = useState<
    'resolve' | 'reopen' | null
  >(null)
  // 退出动画期间保留呈现动作，不参与写入条件
  const [displayAction, setDisplayAction] = useState<
    'resolve' | 'reopen' | null
  >(null)
  // 重开撞上同目标新未结事项：先展示冲突，等用户明确点击后才提交关注
  const [reopenConflictId, setReopenConflictId] = useState<number | null>(null)
  const [reopenContent, setReopenContent] = useState('')
  const [actionError, setActionError] = useState('')
  const [working, setWorking] = useState(false)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const lockRef = useRef(false)

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
        setLoadError(res || '加载详情失败，请稍后重试')
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

  // 换一条问题时清空本地表单状态
  useEffect(() => {
    setReplyContent('')
    setReplyError('')
    setResolution('')
    setResolveContent('')
    setPendingAction(null)
    setDisplayAction(null)
    setReopenConflictId(null)
    setReopenContent('')
    setActionError('')
  }, [caseId])

  const handleReply = async () => {
    const content = replyContent.trim()
    if (!content || lockRef.current) return
    lockRef.current = true
    setWorking(true)
    setReplyError('')
    try {
      const res = await kunFetchPost<CaseMessageResponse | string>(
        `/case/${caseId}/message`,
        { content }
      )
      if (typeof res === 'string') {
        setReplyError(res || '发送失败，请稍后重试')
        return
      }
      setReplyContent('')
      await load()
      onChanged?.()
    } catch {
      // 网络失败保留输入
      setReplyError('网络错误，发送失败，请重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  const openConfirm = (action: 'resolve' | 'reopen') => {
    if (lockRef.current || pendingAction !== null) return
    setActionError('')
    setReopenConflictId(null)
    setReopenContent('')
    if (action === 'resolve' && !resolution) {
      setActionError('请先选择处理结论')
      return
    }
    setDisplayAction(action)
    setPendingAction(action)
  }

  const runAction = async (action: 'resolve' | 'reopen') => {
    if (lockRef.current) return
    lockRef.current = true
    setWorking(true)
    setActionError('')
    try {
      const res =
        action === 'resolve'
          ? await kunFetchPost<CaseActionResponse | string>(
              `/case/${caseId}/resolve`,
              {
                resolution,
                ...(resolveContent.trim()
                  ? { content: resolveContent.trim() }
                  : {})
              }
            )
          : await kunFetchPost<CaseReopenResponse | string>(
              `/case/${caseId}/reopen`,
              {}
            )
      if (typeof res === 'string') {
        setActionError(res || '操作失败，请稍后重试')
        return
      }
      if (action === 'reopen' && 'conflict' in res) {
        // 撞上新未结事项：只展示冲突，不自动提交、不自动关注
        setReopenConflictId(res.existingCaseId)
        return
      }
      setPendingAction(null)
      if (action === 'resolve') {
        setResolution('')
        setResolveContent('')
        toast.success('已结案')
      } else {
        toast.success('已重新打开')
      }
      await load()
      onChanged?.()
    } catch {
      setActionError('网络错误，操作未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  // 用户明确点击后：以旧事项自身类型/目标和本人新填的说明登记关注现有问题
  const handleSubscribeExisting = async () => {
    if (!detail || reopenConflictId === null || lockRef.current) return
    const minLength =
      detail.kind === 'content_violation'
        ? CASE_REPORT_MIN_LENGTH
        : CASE_DESCRIPTION_MIN_LENGTH
    const trimmed = reopenContent.trim()
    if (trimmed.length < minLength) {
      setActionError(`提交说明最少 ${minLength} 个字符`)
      return
    }
    lockRef.current = true
    setWorking(true)
    setActionError('')
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: detail.kind,
        targetType: detail.targetType,
        targetId: detail.targetId,
        content: trimmed
      })
      if (typeof res === 'string') {
        // 目标已删除/权限变化等由现有提交校验返回，保留说明
        setActionError(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        setReopenConflictId(null)
        setActionError('该问题刚刚结案，请稍后重新查看')
        return
      }
      toast.success('已登记，正在处理')
      setPendingAction(null)
      setReopenConflictId(null)
      setReopenContent('')
      onChanged?.()
      // 进入返回的按权限脱敏详情
      router.push(`/issue/${res.case.id}`)
    } catch {
      setActionError('网络错误，提交失败，请重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  if (loading && !detail) {
    return (
      <Card className="gap-4 p-4" role="status" aria-label="正在加载问题详情">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
      </Card>
    )
  }

  if (!detail) {
    return (
      <Card className="py-12">
        <div
          role="alert"
          className="flex flex-col items-center gap-2 px-6 text-center"
        >
          <TriangleAlert className="size-7 text-destructive" aria-hidden />
          <p className="text-sm font-medium">加载失败，请重试</p>
          <p className="text-xs text-muted-foreground">
            {loadError || '无法查看该问题'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      </Card>
    )
  }

  const { capabilities } = detail
  const resolutionLabel = caseResolutionLabel(detail.resolution)
  const closed = detail.status === 'resolved' || detail.status === 'rejected'
  // PM 3.6 把关注者可见范围写成穷举白名单，等待时长与升级倒计时都不在其中。
  // 这里拿一个写权限标志当可见性判据：`canReply` 等价于服务端的
  // `actorCanReply`（管理员、当前发布者处理方、报告者本人），纯关注者三项皆假，
  // 这个集合正好是「该看时限的人」，因此不必让后端另外下发视角标记。
  //
  // 耦合提醒：上面这层等价是当前契约的巧合，不是它承诺的语义。若模块 04 / 07
  // 让 `actorCanReply` 纳入新的一方，时限提示会跟着静默放开，届时必须回到
  // PM 3.6 的白名单重新确认那一方是否也该看到等待时长，而不是默认沿用。
  // tests/unit/case-detail-permissions.test.tsx 的「关注者视角不渲染时限提示」
  // 守住当前结论。
  const statusHint = capabilities.canReply ? caseStatusHint(detail) : null

  // UI1：/case/[id]/resolve 仅当前发布者可用。管理员在用户侧查看时不显示该表单，
  // 改给「在后台处理」入口，站方裁决由后台组件执行。
  const viewerIsOwnerPublisher =
    detail.ownerType === 'publisher' && detail.owner?.id === user.uid
  const showPublisherResolve = capabilities.canResolve && viewerIsOwnerPublisher
  const showStaffDashboardEntry =
    user.role >= 3 &&
    !viewerIsOwnerPublisher &&
    CASE_UNRESOLVED_STATUSES.includes(
      detail.status as (typeof CASE_UNRESOLVED_STATUSES)[number]
    )

  // 重开窗口由服务端的 canReopen 决定（报告者本人、已结案、未重开过、7 天内）；
  // 这里只把剩余时间读出来，不自行判定资格。
  const reopenDeadline = detail.closedAt
    ? Date.parse(detail.closedAt) + CASE_REOPEN_WINDOW_MS
    : Number.NaN
  const reopenRemaining = Number.isNaN(reopenDeadline)
    ? null
    : formatCaseDuration(reopenDeadline - Date.now())

  const minReopenLength =
    detail.kind === 'content_violation'
      ? CASE_REPORT_MIN_LENGTH
      : CASE_DESCRIPTION_MIN_LENGTH

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="space-y-4 p-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="min-w-0 text-lg font-semibold break-words">
              {caseTargetText(detail)}
            </h2>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANTS[detail.status]}>
                {caseStatusLabel(detail.status)}
              </Badge>
              {resolutionLabel ? (
                <Badge variant="outline">{resolutionLabel}</Badge>
              ) : null}
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">#{detail.id}</span>
            <span aria-hidden>·</span>
            <span>{caseKindLabel(detail.kind)}</span>
            <span aria-hidden>·</span>
            <span>提交于 {formatChinaDateTime(detail.created)}</span>
            <span aria-hidden>·</span>
            <span>
              处理方：{detail.ownerType === 'publisher' ? '发布者' : '站方'}
            </span>
            {detail.subscriberCount !== null ? (
              <span>{detail.subscriberCount} 人报告</span>
            ) : null}
          </p>
          {statusHint ? (
            <p className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5 shrink-0" aria-hidden />
              {statusHint}
            </p>
          ) : null}
        </header>

        {detail.viewerSubscription?.submitted ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            你已提交过同类举报，当前处理状态为「{caseStatusLabel(detail.status)}
            」{resolutionLabel ? `，处理结论为「${resolutionLabel}」` : ''}。
          </p>
        ) : null}

        {resolutionLabel ? (
          <section
            aria-label="处理结果"
            className="space-y-2 rounded-lg border p-4"
          >
            <div className="flex items-center gap-2">
              {detail.status === 'resolved' ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              ) : (
                <XCircle className="size-4 shrink-0" aria-hidden />
              )}
              <h3 className="text-sm font-semibold">
                处理结果：{resolutionLabel}
              </h3>
            </div>
            {detail.closedAt ? (
              <p className="text-xs text-muted-foreground">
                结案于 {formatChinaDateTime(detail.closedAt)}
              </p>
            ) : null}
            {capabilities.canReopen ? (
              <>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">问题仍未解决？</p>
                    <p className="text-xs text-muted-foreground">
                      结案后 7 天内可以重新打开一次
                      {reopenRemaining ? `，还剩约 ${reopenRemaining}` : ''}。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => openConfirm('reopen')}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    重新打开
                  </Button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {detail.messages.length > 0 ? (
          <CaseTimeline
            messages={detail.messages}
            reporterId={detail.reporter?.id}
            // reporter 键仅在有权识别报告者的视角下才下发（服务端按
            // includeReporter 整键省略），所以它在不在就是判据。
            identifiesReporter={'reporter' in detail}
            viewerId={user.uid}
          />
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            暂无沟通记录。
          </p>
        )}

        {showStaffDashboardEntry ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              你可以以站方身份在后台处理该问题。
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/case/${detail.id}`}>
                <ExternalLink className="size-4" aria-hidden />
                在后台处理
              </Link>
            </Button>
          </div>
        ) : null}

        {showPublisherResolve ? (
          <section
            aria-label="结案"
            className="space-y-2 rounded-lg border p-4"
          >
            <h3 className="text-sm font-semibold">结案</h3>
            <label htmlFor="issue-resolution" className="sr-only">
              处理结论
            </label>
            <Select
              value={resolution}
              onValueChange={(value) => setResolution(value as CaseResolution)}
              disabled={working}
            >
              <SelectTrigger id="issue-resolution">
                <SelectValue placeholder="请选择处理结论" />
              </SelectTrigger>
              <SelectContent>
                {capabilities.allowedResolutions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CASE_RESOLUTION_LABELS[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              aria-label="结案说明"
              value={resolveContent}
              onChange={(event) => setResolveContent(event.target.value)}
              maxLength={CASE_CONTENT_MAX_LENGTH}
              rows={2}
              disabled={working}
              placeholder="结案说明（可选，纯文字）"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!resolution || working}
                onClick={() => openConfirm('resolve')}
              >
                结案
              </Button>
            </div>
          </section>
        ) : null}

        {actionError && pendingAction === null ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
      </div>

      <div className="border-t bg-muted/30 p-3">
        {capabilities.canReply ? (
          <div className="space-y-2">
            {viewerIsOwnerPublisher ? (
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
            ) : null}
            <Textarea
              aria-label="补充说明内容"
              value={replyContent}
              onChange={(event) => setReplyContent(event.target.value)}
              maxLength={CASE_CONTENT_MAX_LENGTH}
              rows={3}
              disabled={working}
              className="bg-background"
              placeholder="补充说明或回复（纯文字）"
            />
            <div className="flex items-center justify-end gap-3">
              {replyError ? (
                <p role="alert" className="min-w-0 text-sm text-destructive">
                  {replyError}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={!replyContent.trim() || working}
                onClick={() => void handleReply()}
              >
                <Send className="size-4" aria-hidden />
                发送
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {closed
              ? capabilities.canReopen
                ? '该问题已结案，无法继续回复。重新打开后可以继续沟通。'
                : '该问题已结案，无法继续回复。'
              : '你没有回复该问题的权限。'}
          </p>
        )}
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          // 取消 / Esc 关闭且零写入；确认写请求在飞期间禁止关闭
          if (!open && !working) {
            setPendingAction(null)
            setReopenConflictId(null)
            setReopenContent('')
            setActionError('')
          }
        }}
      >
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {displayAction === 'resolve'
                ? '确认结案'
                : reopenConflictId !== null
                  ? '该目标已有正在处理的问题'
                  : '确认重新打开'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {displayAction === 'resolve'
                ? `将以「${
                    CASE_RESOLUTION_LABELS[resolution as CaseResolution] ??
                    resolution
                  }」结案，结案后报告者会收到通知。`
                : reopenConflictId !== null
                  ? '该目标已有一条正在处理的同类问题，这条旧问题不再重开。你可以填写说明后提交并关注现有问题，可查看处理状态，结案后会收到通知。'
                  : '重新打开后，该问题会回到待处理状态并通知处理方；每个问题只能重新打开一次。'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {displayAction === 'reopen' && reopenConflictId !== null ? (
            <div className="space-y-1">
              <label
                htmlFor="issue-reopen-content"
                className="text-sm font-medium"
              >
                提交说明
              </label>
              <Textarea
                id="issue-reopen-content"
                value={reopenContent}
                onChange={(event) => setReopenContent(event.target.value)}
                maxLength={CASE_CONTENT_MAX_LENGTH}
                rows={3}
                disabled={working}
                placeholder={`请填写你的情况说明（至少 ${minReopenLength} 个字符，纯文字）`}
              />
            </div>
          ) : null}

          {actionError && pendingAction !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>取消</AlertDialogCancel>
            {pendingAction === 'reopen' && reopenConflictId !== null ? (
              <Button
                disabled={working || !reopenContent.trim()}
                onClick={() => void handleSubscribeExisting()}
              >
                {working ? '提交中…' : '提交并关注现有问题'}
              </Button>
            ) : (
              <Button
                disabled={working}
                onClick={() => {
                  // 唯一写入口：仅确认按钮调用写函数（内部仍含 ref 锁）
                  if (pendingAction !== null) void runAction(pendingAction)
                }}
              >
                {working ? '处理中…' : '确认'}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
