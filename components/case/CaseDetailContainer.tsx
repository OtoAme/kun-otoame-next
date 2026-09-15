'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea
} from '@heroui/react'
import toast from 'react-hot-toast'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { KunLoading } from '~/components/kun/Loading'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { useUserStore } from '~/store/userStore'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_DESCRIPTION_MIN_LENGTH,
  CASE_QUICK_REPLIES,
  CASE_REPORT_MIN_LENGTH,
  CASE_RESOLUTION_LABELS,
  CASE_UNRESOLVED_STATUSES
} from '~/constants/case'
import {
  caseKindLabel,
  caseMessageAuthorLabel,
  caseResolutionLabel,
  caseStatusLabel,
  caseSystemEventText,
  caseTargetText
} from './caseDisplay'
import type {
  CaseActionResponse,
  CaseCreateResponse,
  CaseDetail,
  CaseDetailResponse,
  CaseMessageResponse,
  CaseReopenResponse,
  CaseResolution,
  CaseStatus
} from '~/types/api/case'

const STATUS_CHIP_COLORS: Record<
  CaseStatus,
  'default' | 'primary' | 'warning' | 'success' | 'danger'
> = {
  open: 'primary',
  waiting_owner: 'primary',
  waiting_reporter: 'warning',
  resolved: 'success',
  rejected: 'danger',
  merged: 'default'
}

type PendingAction = 'resolve' | 'reopen'

interface Props {
  caseId: number
}

export const CaseDetailContainer = ({ caseId }: Props) => {
  const router = useRouter()
  const { user } = useUserStore((state) => state)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [replyContent, setReplyContent] = useState('')
  const [resolution, setResolution] = useState<CaseResolution | ''>('')
  const [resolveContent, setResolveContent] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
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

  const fetchDetail = useCallback(async () => {
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
    void fetchDetail()
  }, [fetchDetail])

  const handleReply = async () => {
    const content = replyContent.trim()
    if (!content || lockRef.current) return
    lockRef.current = true
    setWorking(true)
    try {
      const res = await kunFetchPost<CaseMessageResponse | string>(
        `/case/${caseId}/message`,
        { content }
      )
      if (typeof res === 'string') {
        toast.error(res || '发送失败，请稍后重试')
        return
      }
      setReplyContent('')
      await fetchDetail()
    } catch {
      // 网络失败保留输入
      toast.error('网络错误，发送失败，请重试')
    } finally {
      lockRef.current = false
      setWorking(false)
    }
  }

  const openConfirm = (action: PendingAction) => {
    setActionError('')
    setReopenConflictId(null)
    setReopenContent('')
    if (action === 'resolve' && !resolution) {
      setActionError('请先选择处理结论')
      return
    }
    setPendingAction(action)
  }

  const closeConfirm = () => {
    if (working) return
    setPendingAction(null)
    setReopenConflictId(null)
    setReopenContent('')
    setActionError('')
  }

  const handleConfirmedAction = async () => {
    if (!pendingAction || lockRef.current) return
    const action = pendingAction
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
      await fetchDetail()
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
      <div className="container mx-auto my-8 max-w-3xl px-4">
        <KunLoading hint="正在获取问题详情..." />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="container mx-auto my-8 max-w-3xl space-y-4 px-4">
        <Link href="/issue" className="text-sm text-primary hover:underline">
          返回问题处理
        </Link>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p role="alert" className="text-sm text-danger">
            {loadError || '无法查看该问题'}
          </p>
          <Button
            variant="bordered"
            size="sm"
            onPress={() => void fetchDetail()}
          >
            重试
          </Button>
        </div>
      </div>
    )
  }

  const { capabilities } = detail
  const resolutionLabel = caseResolutionLabel(detail.resolution)
  const allowedResolutionOptions = capabilities.allowedResolutions.map(
    (value) => ({ key: value, label: CASE_RESOLUTION_LABELS[value] ?? value })
  )

  // UI1：/case/[id]/resolve 仅当前发布者可用。管理员前台查看时不显示该表单，
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

  return (
    <div className="container mx-auto my-8 max-w-3xl space-y-6 px-4">
      <Link href="/issue" className="text-sm text-primary hover:underline">
        返回问题处理
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="flat">
            {caseKindLabel(detail.kind)}
          </Chip>
          <Chip
            size="sm"
            variant="flat"
            color={STATUS_CHIP_COLORS[detail.status]}
          >
            {caseStatusLabel(detail.status)}
          </Chip>
          {resolutionLabel && (
            <Chip size="sm" variant="bordered">
              结论：{resolutionLabel}
            </Chip>
          )}
          {detail.subscriberCount !== null && (
            <span className="text-xs text-default-400">
              共 {detail.subscriberCount} 人报告
            </span>
          )}
        </div>
        <h1 className="break-words text-xl font-medium">
          {caseTargetText(detail)}
        </h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-default-400">
          <span>提交于 {formatChinaDateTime(detail.created)}</span>
          <span>
            当前处理方：{detail.ownerType === 'publisher' ? '发布者' : '站方'}
          </span>
          {detail.escalatedAt && <span>已升级站方处理</span>}
          {detail.closedAt && (
            <span>结案于 {formatChinaDateTime(detail.closedAt)}</span>
          )}
        </div>
      </header>

      {detail.viewerSubscription?.submitted && (
        <p className="rounded-xl border border-default-200 bg-default-50 px-4 py-3 text-sm text-default-600">
          你已提交过同类举报，当前处理状态为「
          {caseStatusLabel(detail.status)}」
          {resolutionLabel ? `，处理结论为「${resolutionLabel}」` : ''}。
        </p>
      )}

      {detail.messages.length > 0 && (
        <section aria-label="沟通记录" className="space-y-3">
          <h2 className="text-sm font-medium text-default-600">沟通记录</h2>
          <ul className="space-y-3">
            {detail.messages.map((message) =>
              message.kind === 'system' ? (
                <li key={message.id} className="flex justify-center">
                  <span className="rounded-full bg-default-100 px-3 py-1 text-xs text-default-500">
                    {caseSystemEventText(message)} ·{' '}
                    {formatChinaDateTime(message.created)}
                  </span>
                </li>
              ) : (
                <li
                  key={message.id}
                  className="rounded-2xl border border-default-200 p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-default-400">
                    <span className="font-medium text-default-600">
                      {caseMessageAuthorLabel(message)}
                    </span>
                    <span>{formatChinaDateTime(message.created)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {message.body}
                  </p>
                </li>
              )
            )}
          </ul>
        </section>
      )}

      {capabilities.canReply && (
        <section aria-label="补充说明" className="space-y-2">
          <h2 className="text-sm font-medium text-default-600">补充说明</h2>
          <div className="flex flex-wrap gap-2">
            {CASE_QUICK_REPLIES.map((reply) => (
              <Chip
                key={reply.code}
                as="button"
                variant="bordered"
                onClick={() => setReplyContent(reply.content)}
              >
                {reply.label}
              </Chip>
            ))}
          </div>
          <Textarea
            aria-label="补充说明内容"
            value={replyContent}
            onValueChange={setReplyContent}
            maxLength={CASE_CONTENT_MAX_LENGTH}
            minRows={3}
            placeholder="请输入要补充的说明（纯文字）"
          />
          <div className="flex justify-end">
            <Button
              color="primary"
              size="sm"
              isDisabled={!replyContent.trim() || working}
              isLoading={working && pendingAction === null}
              onPress={() => void handleReply()}
            >
              发送
            </Button>
          </div>
        </section>
      )}

      {(showPublisherResolve ||
        capabilities.canReopen ||
        showStaffDashboardEntry) && (
        <section aria-label="处理操作" className="space-y-3">
          {showStaffDashboardEntry && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-default-200 p-4">
              <p className="text-sm text-default-500">
                你可以以站方身份在后台处理该问题。
              </p>
              <Button
                as={Link}
                href={`/dashboard/case/${detail.id}`}
                variant="bordered"
                size="sm"
              >
                在后台处理
              </Button>
            </div>
          )}

          {showPublisherResolve && (
            <div className="space-y-2 rounded-2xl border border-default-200 p-4">
              <h2 className="text-sm font-medium text-default-600">结案</h2>
              <Select
                aria-label="处理结论"
                placeholder="请选择处理结论"
                selectedKeys={resolution ? [resolution] : []}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return
                  const value = Array.from(keys)[0]
                  setResolution(
                    typeof value === 'string' ? (value as CaseResolution) : ''
                  )
                }}
              >
                {allowedResolutionOptions.map((option) => (
                  <SelectItem key={option.key}>{option.label}</SelectItem>
                ))}
              </Select>
              <Textarea
                aria-label="结案说明"
                value={resolveContent}
                onValueChange={setResolveContent}
                maxLength={CASE_CONTENT_MAX_LENGTH}
                minRows={2}
                placeholder="结案说明（可选，纯文字）"
              />
              <div className="flex justify-end">
                <Button
                  color="primary"
                  size="sm"
                  isDisabled={!resolution || working}
                  onPress={() => openConfirm('resolve')}
                >
                  结案
                </Button>
              </div>
            </div>
          )}

          {capabilities.canReopen && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-default-200 p-4">
              <p className="text-sm text-default-500">
                对处理结果不满意的话，可以在结案后 7 天内重新打开一次。
              </p>
              <Button
                variant="bordered"
                size="sm"
                isDisabled={working}
                onPress={() => openConfirm('reopen')}
              >
                重新打开
              </Button>
            </div>
          )}
        </section>
      )}

      {actionError && !pendingAction && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}

      <Modal isOpen={pendingAction !== null} onClose={closeConfirm}>
        <ModalContent>
          <ModalHeader>
            {pendingAction === 'resolve'
              ? '确认结案'
              : reopenConflictId !== null
                ? '该目标已有正在处理的问题'
                : '确认重新打开'}
          </ModalHeader>
          <ModalBody>
            {pendingAction === 'resolve' ? (
              <p>
                将以「{CASE_RESOLUTION_LABELS[resolution as CaseResolution]}」
                结案，结案后报告者会收到通知。确定要继续吗？
              </p>
            ) : reopenConflictId !== null ? (
              <div className="space-y-3">
                <p>
                  该目标已有一条正在处理的同类问题，这条旧问题不再重开。你可以填写说明后提交并关注现有问题，可查看处理状态，结案后会收到通知。
                </p>
                <Textarea
                  aria-label="提交说明"
                  isRequired
                  value={reopenContent}
                  onValueChange={setReopenContent}
                  maxLength={CASE_CONTENT_MAX_LENGTH}
                  minRows={3}
                  placeholder={`请填写你的情况说明（至少 ${
                    detail.kind === 'content_violation'
                      ? CASE_REPORT_MIN_LENGTH
                      : CASE_DESCRIPTION_MIN_LENGTH
                  } 个字符，纯文字）`}
                />
              </div>
            ) : (
              <p>
                重新打开后，该问题会回到待处理状态并通知处理方；每个问题只能重新打开一次。确定要继续吗？
              </p>
            )}
            {actionError && pendingAction && (
              <p role="alert" className="text-sm text-danger">
                {actionError}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeConfirm} isDisabled={working}>
              取消
            </Button>
            {pendingAction === 'reopen' && reopenConflictId !== null ? (
              <Button
                color="primary"
                isLoading={working}
                isDisabled={working || !reopenContent.trim()}
                onPress={() => void handleSubscribeExisting()}
              >
                提交并关注现有问题
              </Button>
            ) : (
              <Button
                color="primary"
                isLoading={working}
                isDisabled={working}
                onPress={() => void handleConfirmedAction()}
              >
                确认
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
