'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

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
import { Separator } from '~/components/dashboard/ui/separator'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  PATCH_SUBMISSION_PUBLISH_REWARD,
  PATCH_SUBMISSION_REASON_MAX_LENGTH,
  PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE
} from '~/constants/patchSubmission'
import { USER_ROLE_MAP } from '~/constants/user'
import { cn } from '~/lib/dashboard/utils'
import type { InboxItem } from '~/types/api/inbox'
import type { AdminPatchSubmissionDetail } from '~/app/api/admin/patch-submission/service'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'

import { CompanyDiagnostics } from './CompanyDiagnostics'
import { PreviewFrame } from './PreviewFrame'

type SubmissionInboxItem = Extract<InboxItem, { kind: 'submission' }>
type ReviewAction = 'approve' | 'request-changes' | 'reject' | 'violate'

interface SubmissionInboxDetailProps {
  item: SubmissionInboxItem
  reviewerId: number
  reviewerRole: number
  onProcessed: (key: string) => void
  onStateChanged: (key: string) => void
}

const STATUS_META: Record<
  AdminPatchSubmissionDetail['status'],
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  draft: { label: '草稿', variant: 'outline' },
  pending: { label: '待审核', variant: 'secondary' },
  changes_requested: { label: '已要求修改', variant: 'outline' },
  rejected: { label: '已驳回', variant: 'outline' },
  published: { label: '已发布', variant: 'default' },
  violation: { label: '违规处理', variant: 'destructive' },
  deleted: { label: '已删除', variant: 'outline' }
}

function roleLabel(role: number): string {
  const label = USER_ROLE_MAP[role as keyof typeof USER_ROLE_MAP]
  return typeof label === 'string' ? label : `未知角色（${role}）`
}

function MetaField({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  )
}

export function SubmissionInboxDetail({
  item,
  reviewerId,
  reviewerRole,
  onProcessed,
  onStateChanged
}: SubmissionInboxDetailProps) {
  // 详情与错误都按 key+updated 关联保存，渲染时再校验，
  // 保证旧选择/旧版本的数据永远不会显示在新选择下。
  const [detailState, setDetailState] = useState<{
    key: string
    updated: string
    value: AdminPatchSubmissionDetail
  } | null>(null)
  const [errorState, setErrorState] = useState<{
    key: string
    updated: string
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(true)

  const [reason, setReason] = useState('')
  const [overrideSelfReview, setOverrideSelfReview] = useState(false)
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [violateOpen, setViolateOpen] = useState(false)

  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const lockRef = useRef(false)
  // 渲染期间同步刷新选择引用，使 effect 之前完成的过期请求无法命中新选择。
  const keyRef = useRef(item.key)
  keyRef.current = item.key
  const updatedRef = useRef(item.payload.updated)
  updatedRef.current = item.payload.updated

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // 卸载时使仍在飞的请求失效（父组件按 item.key 重新挂载本组件）。
      generationRef.current += 1
    }
  }, [])

  const load = useCallback(async () => {
    if (!mountedRef.current) return
    const generation = ++generationRef.current
    const capturedKey = item.key
    const capturedUpdated = item.payload.updated
    setLoading(true)
    setErrorState(null)
    try {
      const result = await kunFetchGet<AdminPatchSubmissionDetail | string>(
        `/admin/patch-submission/${item.id}`
      )
      if (!mountedRef.current || generation !== generationRef.current) return
      if (typeof result === 'string') {
        setDetailState(null)
        setErrorState({
          key: capturedKey,
          updated: capturedUpdated,
          message: result.length > 0 ? result : '详情加载失败，请稍后重试'
        })
      } else {
        setDetailState({
          key: capturedKey,
          updated: capturedUpdated,
          value: result
        })
      }
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setDetailState(null)
      setErrorState({
        key: capturedKey,
        updated: capturedUpdated,
        message: '网络错误，请检查网络连接后重试'
      })
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [item.id, item.key, item.payload.updated])

  // item.key / item.payload.updated 变化都会触发完整重取：
  // 同 ID 冲突刷新、同 ID 新版本都会重新加载详情。
  useEffect(() => {
    void load()
  }, [load])

  // 切换选中项或同 key 数据版本刷新时，一并清空过期的审核意见/自审勾选/对话框，
  // 避免旧版本关联的本地状态泄漏到新版本详情下。
  useEffect(() => {
    setReason('')
    setActionError(null)
    setOverrideSelfReview(false)
    setViolateOpen(false)
  }, [item.key, item.payload.updated])

  const detail =
    detailState !== null &&
    detailState.key === item.key &&
    detailState.updated === item.payload.updated
      ? detailState.value
      : null
  const fetchError =
    errorState !== null &&
    errorState.key === item.key &&
    errorState.updated === item.payload.updated
      ? errorState.message
      : null

  if (detail === null) {
    if (fetchError !== null && !loading) {
      return (
        <div className="space-y-3" aria-label="投稿详情加载失败">
          <p role="alert" className="text-sm text-destructive">
            {fetchError}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )
    }
    return (
      <div className="space-y-3" aria-busy="true" aria-label="正在加载投稿详情">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const statusMeta = STATUS_META[detail.status]
  const pending = detail.status === 'pending'
  const isSelf = detail.author.id === reviewerId
  const canOverride = isSelf && reviewerRole === 4
  const selfRefused = isSelf && reviewerRole === 3
  const companyDiagnostics = detail.preview?.companyDiagnostics ?? null
  const hasBlockingAmbiguities =
    (companyDiagnostics?.ambiguities.length ?? 0) > 0
  const hasDuplicateInfo =
    detail.vndbDuplicates.length > 0 || detail.duplicateConfirmed

  const baseActionDisabled =
    !pending ||
    working ||
    reviewerRole < 3 ||
    selfRefused ||
    (canOverride && !overrideSelfReview)
  const approveDisabled =
    baseActionDisabled || detail.preview === null || hasBlockingAmbiguities

  const openViolateDialog = () => {
    if (lockRef.current) return
    if (reason.trim().length === 0) {
      setActionError('违规处理必须先填写原因')
      return
    }
    setActionError(null)
    setViolateOpen(true)
  }

  const runAction = async (action: ReviewAction) => {
    if (lockRef.current) return
    const trimmedReason = reason.trim()
    if (action !== 'approve') {
      if (trimmedReason.length === 0) {
        setActionError('请先填写审核意见（必填）')
        return
      }
      if (trimmedReason.length > PATCH_SUBMISSION_REASON_MAX_LENGTH) {
        setActionError(
          `审核意见长度不能超过 ${PATCH_SUBMISSION_REASON_MAX_LENGTH} 字`
        )
        return
      }
    }

    // 点击时捕获全部上下文，之后只认捕获值。
    const capturedKey = item.key
    const capturedUpdated = item.payload.updated
    const capturedId = item.id
    const capturedReason = trimmedReason
    const capturedOverride = canOverride && overrideSelfReview

    // 同步加锁，阻断 await 期间的重复点击。
    lockRef.current = true
    setWorking(true)
    setActionError(null)

    let succeeded = false
    let stateChanged = false
    try {
      const result = await kunFetchPost<string | Record<string, unknown>>(
        `/admin/patch-submission/${action}`,
        {
          submissionId: capturedId,
          overrideSelfReview: capturedOverride,
          ...(action === 'approve' ? {} : { reason: capturedReason })
        }
      )
      if (typeof result === 'string') {
        // 任何字符串都是业务错误；409 的状态变更消息按原样返回。
        if (result === PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE) {
          stateChanged = true
        } else if (
          mountedRef.current &&
          keyRef.current === capturedKey &&
          updatedRef.current === capturedUpdated
        ) {
          setActionError(result.length > 0 ? result : '操作失败，请稍后重试')
        }
      } else {
        succeeded = true
      }
    } catch {
      if (
        mountedRef.current &&
        keyRef.current === capturedKey &&
        updatedRef.current === capturedUpdated
      ) {
        setActionError('网络错误，操作未完成，请稍后重试')
      }
    } finally {
      lockRef.current = false
      if (mountedRef.current) {
        setWorking(false)
      }
    }

    // 父组件回调放在请求 try/catch 之外：回调内部异常不算业务失败；
    // 即使旧选择已卸载，仍携带捕获的 key 回调，父组件据此移除正确的项。
    if (stateChanged) {
      onStateChanged(capturedKey)
      return
    }
    if (succeeded) {
      if (
        mountedRef.current &&
        keyRef.current === capturedKey &&
        updatedRef.current === capturedUpdated
      ) {
        setReason('')
        setActionError(null)
        setOverrideSelfReview(false)
        setViolateOpen(false)
      }
      onProcessed(capturedKey)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="break-all text-base font-semibold">{detail.name}</h3>
        <Badge variant={statusMeta.variant} className="shrink-0">
          {statusMeta.label}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetaField label="作者">
          <a
            href={`/user/${detail.author.id}`}
            className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
          >
            {detail.author.avatar ? (
              <img
                src={detail.author.avatar}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : null}
            <span>{detail.author.name}</span>
          </a>
        </MetaField>
        <MetaField label="投稿时角色">
          {roleLabel(detail.roleAtCreation)}
        </MetaField>
        <MetaField label="冻结押金">{detail.heldAmount}</MetaField>
        <MetaField label="数据版本">{detail.payloadVersion}</MetaField>
        <MetaField label="创建时间">
          {formatChinaDateTime(detail.created)}
        </MetaField>
        <MetaField label="提交时间">
          {detail.submittedAt ? formatChinaDateTime(detail.submittedAt) : '—'}
        </MetaField>
        {detail.externalSource ? (
          <MetaField label="外部来源">{detail.externalSource}</MetaField>
        ) : null}
        {detail.externalFetchedAt ? (
          <MetaField label="抓取时间">
            {formatChinaDateTime(detail.externalFetchedAt)}
          </MetaField>
        ) : null}
        {detail.reviewedBy ? (
          <MetaField label="审核人">
            <a
              href={`/user/${detail.reviewedBy.id}`}
              className="underline-offset-4 hover:underline"
            >
              {detail.reviewedBy.name}
            </a>
          </MetaField>
        ) : null}
        {detail.reviewedAt ? (
          <MetaField label="审核时间">
            {formatChinaDateTime(detail.reviewedAt)}
          </MetaField>
        ) : null}
        {detail.reviewReason ? (
          <MetaField label="审核意见" className="sm:col-span-2">
            <span className="whitespace-pre-wrap">{detail.reviewReason}</span>
          </MetaField>
        ) : null}
        {detail.publishedPatch ? (
          <MetaField label="已发布条目">
            <a
              href={`/${detail.publishedPatch.uniqueId}`}
              className="underline-offset-4 hover:underline"
            >
              {detail.publishedPatch.name}
            </a>
          </MetaField>
        ) : null}
      </dl>

      {hasDuplicateInfo ? (
        <>
          <Separator />
          <section
            aria-label="VNDB 重复警告"
            className={cn(
              'space-y-2 rounded-md border p-3 text-sm',
              detail.vndbDuplicates.length > 0
                ? 'border-amber-500/50 bg-amber-500/10'
                : 'border-border'
            )}
          >
            <h4 className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              VNDB ID 重复警告
            </h4>
            {detail.vndbDuplicates.length > 0 ? (
              <>
                <p>
                  以下已发布条目使用了相同的 VNDB ID（同一 ID
                  可能属于不同版本，是否通过由审核人判断）：
                </p>
                <ul className="ml-5 list-disc space-y-1">
                  {detail.vndbDuplicates.map((dup) => (
                    <li key={dup.uniqueId}>
                      <a
                        href={`/${dup.uniqueId}`}
                        className="underline underline-offset-4"
                      >
                        {dup.name}
                      </a>
                    </li>
                  ))}
                </ul>
                {detail.duplicatesTruncated ? (
                  <p className="text-xs text-muted-foreground">仅列出前10条</p>
                ) : null}
              </>
            ) : null}
            {detail.duplicateConfirmed ? (
              <p>投稿人已确认知晓上述重复并仍然提交。</p>
            ) : detail.vndbDuplicates.length > 0 ? (
              <p>{pending ? '投稿者未确认' : '投稿者当时未确认'}</p>
            ) : null}
          </section>
        </>
      ) : null}

      {companyDiagnostics ? (
        <>
          <Separator />
          <section className="space-y-3" aria-label="会社诊断">
            <h4 className="text-sm font-semibold">会社诊断</h4>
            <CompanyDiagnostics diagnostics={companyDiagnostics} />
          </section>
        </>
      ) : null}

      <Separator />

      <section className="space-y-2" aria-label="前台预览">
        <h4 className="text-sm font-semibold">前台预览</h4>
        {detail.preview ? (
          <PreviewFrame
            src={`/preview/submission/${item.id}`}
            title="投稿前台预览"
            className="w-full"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            前台预览不可用，已禁用“通过并发布”；其余审核操作仍按状态与权限正常执行。
          </p>
        )}
      </section>

      <Separator />

      <section className="space-y-3" aria-label="审核操作">
        <h4 className="text-sm font-semibold">审核操作</h4>

        {!pending ? (
          <p className="text-sm text-muted-foreground">
            该投稿当前状态为「{statusMeta.label}」，审核操作不可用，仅可查看。
          </p>
        ) : null}
        {reviewerRole < 3 ? (
          <p role="alert" className="text-sm text-destructive">
            当前账号没有审核权限，仅可查看。
          </p>
        ) : null}
        {selfRefused ? (
          <p role="alert" className="text-sm text-destructive">
            不能审核自己的投稿，请交由其他审核人处理。
          </p>
        ) : null}
        {canOverride ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="submission-override-self-review"
              checked={overrideSelfReview}
              onCheckedChange={(checked) =>
                setOverrideSelfReview(checked === true)
              }
              disabled={working}
            />
            <label
              htmlFor="submission-override-self-review"
              className="text-sm"
            >
              超级管理员自审（将记录日志）
            </label>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label
            htmlFor="submission-review-reason"
            className="text-sm font-medium"
          >
            审核意见（要求修改 / 驳回 / 违规处理时必填）
          </label>
          <Textarea
            id="submission-review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={PATCH_SUBMISSION_REASON_MAX_LENGTH}
            rows={4}
            disabled={working || !pending}
            placeholder="填写给投稿人的审核意见"
            aria-describedby={
              actionError !== null && !violateOpen
                ? 'submission-review-reason-hint submission-action-error'
                : 'submission-review-reason-hint'
            }
          />
          <p
            id="submission-review-reason-hint"
            className="text-xs text-muted-foreground"
          >
            {reason.length}/{PATCH_SUBMISSION_REASON_MAX_LENGTH}
          </p>
        </div>

        {actionError !== null && !violateOpen ? (
          <p
            role="alert"
            id="submission-action-error"
            className="text-sm text-destructive"
          >
            {actionError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-inbox-action="positive"
            disabled={approveDisabled}
            onClick={() => void runAction('approve')}
          >
            通过并发布
          </Button>
          <Button
            variant="outline"
            disabled={baseActionDisabled}
            onClick={() => void runAction('request-changes')}
          >
            要求修改
          </Button>
          <Button
            variant="outline"
            disabled={baseActionDisabled}
            onClick={() => void runAction('reject')}
          >
            驳回
          </Button>
          <Button
            variant="destructive"
            data-inbox-action="destructive"
            disabled={baseActionDisabled}
            onClick={openViolateDialog}
          >
            违规处理
          </Button>
          {working ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              正在提交…
            </span>
          ) : null}
        </div>

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            通过并发布：立即发布，返还冻结押金 {detail.heldAmount}，并发放{' '}
            {PATCH_SUBMISSION_PUBLISH_REWARD} 奖励。
          </li>
          <li>
            要求修改：押金 {detail.heldAmount}{' '}
            继续冻结，等待投稿人修改后重新提交。
          </li>
          <li>驳回：返还押金 {detail.heldAmount}。</li>
          <li>
            违规处理：没收押金 {detail.heldAmount}
            ，清空本次投稿内容并清理其上传文件。
          </li>
        </ul>

        {detail.preview === null ? (
          <p className="text-xs text-destructive">前台预览不可用，无法通过。</p>
        ) : null}
        {hasBlockingAmbiguities ? (
          <p className="text-xs text-destructive">
            存在阻塞性会社歧义，已禁用“通过并发布”。
          </p>
        ) : null}

        <AlertDialog
          open={violateOpen}
          onOpenChange={(open) => {
            if (!working) setViolateOpen(open)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认违规处理</AlertDialogTitle>
              <AlertDialogDescription>
                违规处理将没收本次投稿冻结的押金 {detail.heldAmount}
                ，清空本次投稿内容并清理其上传文件，此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">违规原因</p>
              <p className="whitespace-pre-wrap break-words">{reason.trim()}</p>
            </div>
            {actionError !== null ? (
              <p
                role="alert"
                id="violate-action-error"
                className="text-sm text-destructive"
              >
                {actionError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={working}>取消</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={baseActionDisabled}
                onClick={() => void runAction('violate')}
              >
                {working ? '处理中…' : '确认违规处理'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  )
}
