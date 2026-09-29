'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  PencilLine,
  RotateCcw,
  Scale,
  Send,
  TriangleAlert,
  Undo2,
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from '~/components/dashboard/ui/avatar'
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
  CASE_HANDLER_RESOLUTIONS_BY_KIND,
  CASE_QUICK_REPLIES,
  CASE_REOPEN_WINDOW_MS,
  CASE_REPORT_MIN_LENGTH,
  CASE_RESOLUTION_LABELS,
  CASE_UNRESOLVED_STATUSES,
  caseQuickRepliesFor
} from '~/constants/case'
import {
  caseClosingNoteError,
  caseKindLabel,
  caseMessageAuthorLabel,
  caseMessageSide,
  caseOwnerLabel,
  caseResolutionLabel,
  caseStatusHint,
  caseStatusLabel,
  caseSystemEventText,
  caseTargetHref,
  caseTargetText,
  formatCaseRemaining
} from '~/components/case/caseDisplay'
import { useCaseImageUploads } from '~/components/case/useCaseImageUploads'
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

import { CaseMessageText } from '~/components/dashboard/case/CaseMessageText'

import { IssueImageField } from './IssueImageField'

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

/** Writes behind a confirmation dialog; each maps to one case API route. */
type IssueAction = 'resolve' | 'reopen' | 'review' | 'withdraw' | 'propose'

const OUT_OF_SCOPE_TEMPLATE =
  CASE_QUICK_REPLIES.find((reply) => reply.code === 'out_of_scope')?.content ??
  ''

interface IssueCaseDetailProps {
  caseId: number
  /** 工作区上下文：详情里的写操作改变了列表行时回调。 */
  onChanged?: () => void
}

/**
 * 会话时间轴。系统事件用分隔线呈现，回复按署名一方区分（报告者、其他报告者、
 * 处理方，D15），附图随所在的那条对话显示（D11）。本系统的状态机是
 * open/waiting_owner ↔ waiting_reporter 往复后才终结，没有单向阶段，所以这里
 * 不画阶段进度条。用户侧拿不到 payload（服务端只给 admin 视角下发），系统事件
 * 文案走服务端合成的 body 与事件回退。
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
              <Separator className="min-w-4 flex-1" />
              {/* 结案说明等长文本要能换行，不能被卡片裁掉 */}
              <span className="max-w-[85%] min-w-0 text-center break-words">
                <CaseMessageText text={caseSystemEventText(message)} /> ·{' '}
                {formatChinaDateTime(message.created)}
              </span>
              <Separator className="min-w-4 flex-1" />
            </li>
          )
        }
        const authorName = caseMessageAuthorLabel(message, identifiesReporter)
        const isViewer =
          message.author !== null && message.author.id === viewerId
        // 注销账号无法判定属于哪一侧，不贴角色徽标而不是猜一个
        // 处理方一侧按实际身份署名：站方介入写「网站管理员」，转交后写「原发布者」
        const sideLabel =
          side === 'owner'
            ? message.authorSide === 'staff'
              ? '网站管理员'
              : message.authorSide === 'original-publisher'
                ? '原发布者'
                : '处理方'
            : side === 'reporter'
              ? '报告者'
              : side === 'other-reporter'
                ? isViewer
                  ? '报告者'
                  : '其他报告者'
                : null
        return (
          <li key={message.id} className="flex gap-3">
            {/* 名字就在右侧以文字出现，头像与首字都只作装饰 */}
            <Avatar aria-hidden className="mt-0.5">
              {message.author?.avatar ? (
                <AvatarImage src={message.author.avatar} alt="" />
              ) : null}
              <AvatarFallback
                className={cn(
                  'text-xs font-medium',
                  side === 'owner' && 'bg-primary text-primary-foreground',
                  // 注销账号：不偏向任何一侧，虚线圈与虚线气泡
                  side === 'unknown' && 'border border-dashed bg-transparent'
                )}
              >
                {authorName.trim().slice(0, 1)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {authorName}
                </span>
                {sideLabel ? (
                  <Badge variant={side === 'owner' ? 'secondary' : 'outline'}>
                    {sideLabel}
                  </Badge>
                ) : null}
                {isViewer ? <span>（我）</span> : null}
                <span>{formatChinaDateTime(message.created)}</span>
              </span>
              <span
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap',
                  side === 'owner' ? 'bg-muted' : 'border',
                  side === 'unknown' && 'border-dashed',
                  // D27：被网站管理员隐藏的对话只剩占位文字
                  message.hidden && 'border-dashed text-muted-foreground italic'
                )}
              >
                <CaseMessageText text={message.body} />
              </span>
              {message.images?.length ? (
                <span className="flex flex-wrap gap-2">
                  {message.images.map((url, index) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      <img
                        src={url}
                        alt={`${authorName}的附图 ${index + 1}`}
                        loading="lazy"
                        className="size-20 rounded-md border object-cover"
                      />
                    </a>
                  ))}
                </span>
              ) : null}
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
  const replyUploads = useCaseImageUploads()
  const [resolution, setResolution] = useState<CaseResolution | ''>('')
  const [resolveContent, setResolveContent] = useState('')
  const [proposeResolution, setProposeResolution] = useState<
    CaseResolution | ''
  >('')
  const [proposeContent, setProposeContent] = useState('')
  const [pendingAction, setPendingAction] = useState<IssueAction | null>(null)
  // 退出动画期间保留呈现动作，不参与写入条件
  const [displayAction, setDisplayAction] = useState<IssueAction | null>(null)
  // 重开与复核的理由（D16、D19）
  const [reasonContent, setReasonContent] = useState('')
  // 重开或复核撞上同目标新未结事项：先展示冲突，等用户明确点击后才提交关注
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
  const resetReplyUploads = replyUploads.reset
  useEffect(() => {
    setReplyContent('')
    setReplyError('')
    resetReplyUploads()
    setResolution('')
    setResolveContent('')
    setProposeResolution('')
    setProposeContent('')
    setPendingAction(null)
    setDisplayAction(null)
    setReasonContent('')
    setReopenConflictId(null)
    setReopenContent('')
    setActionError('')
  }, [caseId, resetReplyUploads])

  const handleReply = async () => {
    const content = replyContent.trim()
    if (!content || replyUploads.uploading || lockRef.current) return
    lockRef.current = true
    setWorking(true)
    setReplyError('')
    try {
      const res = await kunFetchPost<CaseMessageResponse | string>(
        `/case/${caseId}/message`,
        { content, imageKeys: replyUploads.keys }
      )
      if (typeof res === 'string') {
        setReplyError(res || '发送失败，请稍后重试')
        return
      }
      setReplyContent('')
      replyUploads.reset()
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

  const openConfirm = (action: IssueAction) => {
    if (!detail || lockRef.current || pendingAction !== null) return
    setActionError('')
    setReasonContent('')
    setReopenConflictId(null)
    setReopenContent('')
    if (action === 'resolve') {
      if (!resolution) {
        setActionError('请先选择处理结论')
        return
      }
      const noteError = caseClosingNoteError(detail, resolution, resolveContent)
      if (noteError) {
        setActionError(noteError)
        return
      }
    }
    if (action === 'propose') {
      if (!proposeResolution) {
        setActionError('请先选择提请的结论')
        return
      }
      if (!proposeContent.trim()) {
        setActionError('请写明你做了什么')
        return
      }
      const noteError = caseClosingNoteError(
        detail,
        proposeResolution,
        proposeContent
      )
      if (noteError) {
        setActionError(noteError)
        return
      }
    }
    setDisplayAction(action)
    setPendingAction(action)
  }

  const postAction = (action: IssueAction) => {
    switch (action) {
      case 'resolve':
        return kunFetchPost<CaseActionResponse | string>(
          `/case/${caseId}/resolve`,
          {
            resolution,
            ...(resolveContent.trim() ? { content: resolveContent.trim() } : {})
          }
        )
      case 'reopen':
      case 'review':
        return kunFetchPost<CaseReopenResponse | string>(
          `/case/${caseId}/${action}`,
          { content: reasonContent.trim() }
        )
      case 'withdraw':
        return kunFetchPost<CaseActionResponse | string>(
          `/case/${caseId}/withdraw`,
          {}
        )
      case 'propose':
        return kunFetchPost<CaseActionResponse | string>(
          `/case/${caseId}/propose`,
          { resolution: proposeResolution, content: proposeContent.trim() }
        )
    }
  }

  const runAction = async (action: IssueAction) => {
    if (lockRef.current) return
    if ((action === 'reopen' || action === 'review') && !reasonContent.trim()) {
      setActionError('请写明理由')
      return
    }
    lockRef.current = true
    setWorking(true)
    setActionError('')
    try {
      const res = await postAction(action)
      if (typeof res === 'string') {
        setActionError(res || '操作失败，请稍后重试')
        return
      }
      if ('conflict' in res) {
        // 撞上新未结事项：只展示冲突，不自动提交、不自动关注
        setReopenConflictId(res.existingCaseId)
        return
      }
      setPendingAction(null)
      setReasonContent('')
      if (action === 'resolve') {
        setResolution('')
        setResolveContent('')
      }
      if (action === 'propose') {
        setProposeResolution('')
        setProposeContent('')
      }
      toast.success(
        action === 'resolve'
          ? '已结案'
          : action === 'reopen'
            ? '已重新打开'
            : action === 'review'
              ? '已提交给网站管理员复核'
              : action === 'propose'
                ? '已提请网站管理员结案'
                : res.case.status === 'resolved'
                  ? '已撤回，问题已结束'
                  : '已撤回你的报告，问题改由其他报告者跟进'
      )
      if (action === 'withdraw' && res.case.status !== 'resolved') {
        // D33：下一位报告者接替后本人不能再打开这条问题，回到列表
        onChanged?.()
        router.push('/issue')
        return
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

  // 结案确认（D19）：「没解决」接着打开当时还能用的重开或复核
  const handleConfirm = async (solved: boolean) => {
    if (!detail || lockRef.current) return
    const next: IssueAction | null = solved
      ? null
      : detail.capabilities.canReopen
        ? 'reopen'
        : detail.capabilities.canReview
          ? 'review'
          : null
    lockRef.current = true
    setWorking(true)
    setActionError('')
    let recorded = false
    try {
      const res = await kunFetchPost<CaseActionResponse | string>(
        `/case/${caseId}/confirm`,
        { solved }
      )
      if (typeof res === 'string') {
        setActionError(res || '操作失败，请稍后重试')
        return
      }
      recorded = true
      toast.success(
        solved
          ? '感谢确认'
          : next
            ? '已记录，请写明哪里还没有解决'
            : '已记录。这个问题已不能再重开或复核，仍遇到问题可以重新提交'
      )
      await load()
      onChanged?.()
    } catch {
      setActionError('网络错误，操作未完成，请稍后重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
    if (recorded && next) {
      setReasonContent('')
      setReopenConflictId(null)
      setReopenContent('')
      setDisplayAction(next)
      setPendingAction(next)
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
    // 无权查看或已不存在时重试没有意义，只给回到列表的出路
    const permanent =
      loadError === '无权查看该问题' || loadError === '问题不存在'
    return (
      <Card className="py-12">
        <div
          role="alert"
          className="flex flex-col items-center gap-2 px-6 text-center"
        >
          <TriangleAlert className="size-7 text-destructive" aria-hidden />
          <p className="text-sm font-medium">
            {permanent ? '无法查看这个问题' : '加载失败，请重试'}
          </p>
          <p className="text-xs text-muted-foreground">
            {loadError || '无法查看该问题'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => (permanent ? router.push('/issue') : void load())}
          >
            {permanent ? '返回问题处理' : '重新加载'}
          </Button>
        </div>
      </Card>
    )
  }

  const { capabilities } = detail
  const closed = detail.status === 'resolved' || detail.status === 'rejected'
  // 重开与复核保留上一轮结论（实施计划 5.4），未结时不当作当前结果展示
  const resolutionLabel = closed ? caseResolutionLabel(detail.resolution) : null
  // PM 3.6 把关注者可见范围写成穷举白名单，等待时长与升级倒计时都不在其中。
  // 这里拿一个写权限标志当可见性判据：`canReply` 等价于服务端的
  // `actorCanReply`（管理员、当前发布者处理方、报告者本人、转交后的原发布者），
  // 纯关注者皆假，这个集合正好是「该看时限的人」，因此不必让后端另外下发视角标记。
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
  // 转交后的原发布者（D20）只由服务端的 canPropose 标出
  const viewerIsHandedOffPublisher = capabilities.canPropose
  const targetHref = caseTargetHref(detail)
  const showEditResource =
    detail.targetType === 'resource' &&
    targetHref !== null &&
    (viewerIsOwnerPublisher || viewerIsHandedOffPublisher)

  // 重开与复核窗口由服务端决定（报告者本人、已结案、7 天内）；
  // 这里只把剩余时间读出来，不自行判定资格。
  const reopenDeadline = detail.closedAt
    ? Date.parse(detail.closedAt) + CASE_REOPEN_WINDOW_MS
    : Number.NaN
  const reopenRemaining = Number.isNaN(reopenDeadline)
    ? null
    : formatCaseRemaining(reopenDeadline - Date.now())
  const remainingText = reopenRemaining ? `，还剩约 ${reopenRemaining}` : ''

  const minReopenLength =
    detail.kind === 'content_violation'
      ? CASE_REPORT_MIN_LENGTH
      : CASE_DESCRIPTION_MIN_LENGTH
  const resolveNoteRule = resolution
    ? caseClosingNoteError(detail, resolution, '')
    : null
  const proposeNoteRule = proposeResolution
    ? caseClosingNoteError(detail, proposeResolution, '')
    : null
  const proposeResolutions = CASE_HANDLER_RESOLUTIONS_BY_KIND[detail.kind] ?? []

  const dialogTitle =
    displayAction === 'resolve'
      ? '确认结案'
      : displayAction === 'withdraw'
        ? '确认撤回'
        : displayAction === 'propose'
          ? '确认提请结案'
          : reopenConflictId !== null
            ? '该目标已有正在处理的问题'
            : displayAction === 'review'
              ? '请网站管理员复核'
              : '重新打开'
  const dialogDescription =
    displayAction === 'resolve'
      ? `将以「${
          CASE_RESOLUTION_LABELS[resolution as CaseResolution] ?? resolution
        }」结案，结案后报告者会收到通知。`
      : displayAction === 'withdraw'
        ? '没有其他人报告同一问题时，这条问题会以「开启者撤回」结束；还有其他报告者时，问题改由下一位报告者跟进，你写过的说明仍保留在事项里，你将不再收到这条问题的通知，也不能再打开它。'
        : displayAction === 'propose'
          ? `将提请以「${
              CASE_RESOLUTION_LABELS[proposeResolution as CaseResolution] ??
              proposeResolution
            }」结案，网站管理员确认后才会结案。`
          : reopenConflictId !== null
            ? '该目标已有一条正在处理的同类问题，这条旧问题不再重开。你可以填写说明后提交并关注现有问题，可查看处理状态，结案后会收到通知。'
            : displayAction === 'review'
              ? '提交后这条问题会交给网站管理员复核，发布者也会收到通知。网站管理员的结论是最终结果，之后不能再重开或复核。'
              : '重新打开后，该问题会回到待处理状态并通知处理方；每个问题只能重新打开一次。'
  const needsReason =
    (displayAction === 'reopen' || displayAction === 'review') &&
    reopenConflictId === null

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="space-y-4 p-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="min-w-0 text-lg font-semibold break-words">
              {targetHref ? (
                <Link
                  href={targetHref}
                  className="underline-offset-4 hover:underline"
                >
                  {caseTargetText(detail)}
                </Link>
              ) : (
                caseTargetText(detail)
              )}
            </h2>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {viewerIsHandedOffPublisher ? (
                <Badge variant="secondary">已交给网站管理员</Badge>
              ) : null}
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
            <span>处理方：{caseOwnerLabel(detail.ownerType)}</span>
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
          {showEditResource ? (
            <Button asChild variant="outline" size="sm">
              <Link href={targetHref}>
                <PencilLine className="size-4" aria-hidden />
                去修改资源
              </Link>
            </Button>
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
            {capabilities.canConfirm ? (
              <>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">问题解决了吗？</p>
                    <p className="text-xs text-muted-foreground">
                      结案后 7 天内可以告诉我们结果{remainingText}。
                      {capabilities.canReopen
                        ? '没解决可以重新打开一次。'
                        : capabilities.canReview
                          ? '没解决可以请网站管理员复核。'
                          : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={working}
                      onClick={() => void handleConfirm(true)}
                    >
                      解决了
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={working}
                      onClick={() => void handleConfirm(false)}
                    >
                      没解决
                    </Button>
                  </div>
                </div>
              </>
            ) : capabilities.canReopen ? (
              <>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">问题仍未解决？</p>
                    <p className="text-xs text-muted-foreground">
                      结案后 7 天内可以重新打开一次{remainingText}。
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
            ) : capabilities.canReview ? (
              <>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">
                      对发布者的结论仍有异议？
                    </p>
                    <p className="text-xs text-muted-foreground">
                      可以请网站管理员复核一次，网站管理员的结论是最终结果
                      {remainingText}。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => openConfirm('review')}
                  >
                    <Scale className="size-4" aria-hidden />
                    请网站管理员复核
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
              你可以以网站管理员身份在后台处理该问题。
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
              placeholder={
                resolveNoteRule
                  ? '结案说明（必填，纯文字）'
                  : '结案说明（可选，纯文字）'
              }
            />
            {resolveNoteRule ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {resolveNoteRule}
                </p>
                {resolution === 'out_of_scope' && OUT_OF_SCOPE_TEMPLATE ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => setResolveContent(OUT_OF_SCOPE_TEMPLATE)}
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
                onClick={() => openConfirm('resolve')}
              >
                结案
              </Button>
            </div>
          </section>
        ) : null}

        {viewerIsHandedOffPublisher ? (
          <section
            aria-label="提请结案"
            className="space-y-2 rounded-lg border p-4"
          >
            <h3 className="text-sm font-semibold">提请结案</h3>
            <p className="text-xs text-muted-foreground">
              这条问题已交给网站管理员处理。你仍可以回复；已经处理好时，选一个结论并写明做了什么，由网站管理员确认后结案。
            </p>
            <label htmlFor="issue-propose-resolution" className="sr-only">
              提请的结论
            </label>
            <Select
              value={proposeResolution}
              onValueChange={(value) =>
                setProposeResolution(value as CaseResolution)
              }
              disabled={working}
            >
              <SelectTrigger id="issue-propose-resolution">
                <SelectValue placeholder="请选择提请的结论" />
              </SelectTrigger>
              <SelectContent>
                {proposeResolutions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CASE_RESOLUTION_LABELS[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              aria-label="提请说明"
              value={proposeContent}
              onChange={(event) => setProposeContent(event.target.value)}
              maxLength={CASE_CONTENT_MAX_LENGTH}
              rows={2}
              disabled={working}
              placeholder="你做了什么（必填，纯文字）"
            />
            {proposeNoteRule ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {proposeNoteRule}
                </p>
                {proposeResolution === 'out_of_scope' &&
                OUT_OF_SCOPE_TEMPLATE ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => setProposeContent(OUT_OF_SCOPE_TEMPLATE)}
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
                disabled={
                  !proposeResolution || !proposeContent.trim() || working
                }
                onClick={() => openConfirm('propose')}
              >
                提请结案
              </Button>
            </div>
          </section>
        ) : null}

        {capabilities.canWithdraw ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              问题已经解决，或者不再需要处理？
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => openConfirm('withdraw')}
            >
              <Undo2 className="size-4" aria-hidden />
              撤回
            </Button>
          </div>
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
            {viewerIsOwnerPublisher || viewerIsHandedOffPublisher ? (
              <div className="flex flex-wrap gap-2">
                {caseQuickRepliesFor(detail.kind).map((reply) => (
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
              placeholder="补充说明或回复（纯文字，可以附图）"
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <IssueImageField uploads={replyUploads} disabled={working} />
              <div className="flex items-center gap-3">
                {replyError ? (
                  <p role="alert" className="min-w-0 text-sm text-destructive">
                    {replyError}
                  </p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !replyContent.trim() || working || replyUploads.uploading
                  }
                  onClick={() => void handleReply()}
                >
                  <Send className="size-4" aria-hidden />
                  发送
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {closed
              ? capabilities.canReopen || capabilities.canReview
                ? '该问题已结案，无法继续回复。重新打开或申请复核后可以继续沟通。'
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
            setReasonContent('')
            setReopenConflictId(null)
            setReopenContent('')
            setActionError('')
          }
        }}
      >
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          {needsReason ? (
            <div className="space-y-1">
              <label
                htmlFor="issue-action-reason"
                className="text-sm font-medium"
              >
                {displayAction === 'review' ? '复核理由' : '重开理由'}
              </label>
              <Textarea
                id="issue-action-reason"
                value={reasonContent}
                onChange={(event) => setReasonContent(event.target.value)}
                maxLength={CASE_CONTENT_MAX_LENGTH}
                rows={3}
                disabled={working}
                placeholder="哪里还没有解决（必填，纯文字）"
              />
            </div>
          ) : null}

          {(displayAction === 'reopen' || displayAction === 'review') &&
          reopenConflictId !== null ? (
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
            {(pendingAction === 'reopen' || pendingAction === 'review') &&
            reopenConflictId !== null ? (
              <Button
                disabled={working || !reopenContent.trim()}
                onClick={() => void handleSubscribeExisting()}
              >
                {working ? '提交中…' : '提交并关注现有问题'}
              </Button>
            ) : (
              <Button
                disabled={working || (needsReason && !reasonContent.trim())}
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
