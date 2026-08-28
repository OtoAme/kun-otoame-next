'use client'

import { useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea
} from '@heroui/react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useRouter } from '@bprogress/next'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import { kunFetchPost } from '~/utils/kunFetch'
import {
  PATCH_SUBMISSION_PUBLISH_REWARD,
  PATCH_SUBMISSION_REASON_MAX_LENGTH,
  PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE
} from '~/constants/patchSubmission'
import { PatchSubmissionPreviewView } from '~/components/submission/PatchSubmissionPreviewView'
import type { AdminPatchSubmissionDetail } from '~/app/api/admin/patch-submission/service'

type ReviewAction = 'approve' | 'reject' | 'request-changes' | 'violate'

const ACTION_LABEL: Record<ReviewAction, string> = {
  approve: '通过并发布',
  reject: '驳回并返还押金',
  'request-changes': '要求修改',
  violate: '判定违规并扣除押金'
}

/**
 * 通过的提示要报出具体数字, 所以整张表统一收成函数。押金取投稿行上冻结的
 * heldAmount, 不按审核人当前角色重算 —— 返还的就是当初扣下的那一笔。
 */
const ACTION_HINT: Record<ReviewAction, (heldAmount: number) => string> = {
  approve: (heldAmount) =>
    heldAmount > 0
      ? `将按当前预览创建正式条目，返还投稿人押金 ${heldAmount} 萌萌点，并发放 ${PATCH_SUBMISSION_PUBLISH_REWARD} 萌萌点投稿奖励。`
      : `将按当前预览创建正式条目，并发放 ${PATCH_SUBMISSION_PUBLISH_REWARD} 萌萌点投稿奖励。`,
  reject: () => '用于重复、超出收录范围或诚实但无法发布的投稿。押金全额返还。',
  'request-changes': () => '投稿回到作者手中继续编辑，押金保持暂扣。',
  violate: () => '仅用于违规内容。押金被扣除，作者可见内容与素材立即下架。'
}

const STATUS_LABEL: Record<AdminPatchSubmissionDetail['status'], string> = {
  draft: '草稿',
  pending: '待审核',
  changes_requested: '要求修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

const formatDateTime = (value: string | null) =>
  value ? formatChinaDateTime(value) : '—'

interface Props {
  submission: AdminPatchSubmissionDetail
  reviewerId: number
  reviewerRole: number
}

export const AdminSubmissionDetail = ({
  submission,
  reviewerId,
  reviewerRole
}: Props) => {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<ReviewAction | null>(null)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  const [overrideSelfReview, setOverrideSelfReview] = useState(false)
  const preview = submission.preview
  const isSelfReview = reviewerId === submission.author.id
  const canOverrideSelfReview = isSelfReview && reviewerRole >= 4
  const isPendingReview = submission.status === 'pending'

  const openAction = (action: ReviewAction) => {
    setPendingAction(action)
    setReason('')
  }

  const runAction = async () => {
    if (!pendingAction) return
    setWorking(true)
    try {
      const response = await kunFetchPost<string | Record<string, unknown>>(
        `/admin/patch-submission/${pendingAction}`,
        {
          submissionId: submission.id,
          overrideSelfReview: canOverrideSelfReview && overrideSelfReview,
          ...(pendingAction === 'approve' ? {} : { reason: reason.trim() })
        }
      )
      if (typeof response === 'string') {
        toast.error(response)
        if (response === PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE) {
          setPendingAction(null)
          setReason('')
          router.refresh()
        }
        return
      }
      toast.success(pendingAction === 'approve' ? '已通过并发布' : '投稿已处理')
      setPendingAction(null)
      setReason('')
      router.refresh()
    } catch (error) {
      console.error('Failed to review a submission', error)
      toast.error('操作失败，请检查网络后重试')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button as={Link} href="/admin/submission" size="sm" variant="flat">
          返回审核队列
        </Button>
        <Chip color="primary" variant="flat">
          {STATUS_LABEL[submission.status]}
        </Chip>
        <span className="text-sm text-default-500">投稿 #{submission.id}</span>
        {submission.publishedPatch && (
          <Button
            as={Link}
            href={`/${submission.publishedPatch.uniqueId}`}
            target="_blank"
            size="sm"
            variant="flat"
            color="primary"
          >
            已发布为 {submission.publishedPatch.name}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar
              size="sm"
              src={submission.author.avatar}
              name={submission.author.name}
            />
            <div className="text-sm">
              <Link
                href={`/user/${submission.author.id}`}
                className="text-primary hover:underline"
              >
                {submission.author.name}
              </Link>
              <p className="text-default-500">
                暂扣 {submission.heldAmount} 萌萌点 · 提交于{' '}
                {formatDateTime(submission.submittedAt)}
              </p>
            </div>
          </div>
        </CardHeader>
        <Divider />
        <CardBody className="space-y-2 text-sm">
          <div className="grid gap-2 md:grid-cols-2">
            <p>
              <span className="text-default-500">payload 版本：</span>
              {submission.payloadVersion}
            </p>
            <p>
              <span className="text-default-500">创建时间：</span>
              {formatDateTime(submission.created)}
            </p>
            {submission.externalSource && (
              <p>
                <span className="text-default-500">外部数据来源：</span>
                {submission.externalSource}
                {submission.externalFetchedAt
                  ? `（${formatDateTime(submission.externalFetchedAt)}）`
                  : ''}
              </p>
            )}
            {submission.reviewedBy && (
              <p>
                <span className="text-default-500">审核人：</span>
                {submission.reviewedBy.name}（
                {formatDateTime(submission.reviewedAt)}）
              </p>
            )}
            {submission.reviewReason && (
              <p className="md:col-span-2">
                <span className="text-default-500">审核原因：</span>
                {submission.reviewReason}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {submission.vndbDuplicates.length > 0 && (
        <Card
          className={
            isPendingReview
              ? 'border border-warning-200 bg-warning-50/50 dark:bg-warning-100/10'
              : undefined
          }
        >
          <CardHeader className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium">
              {isPendingReview
                ? 'VNDB ID 与现有条目重复'
                : '共用此 VNDB ID 的其他条目'}
            </h2>
            <Chip
              size="sm"
              variant="flat"
              color={
                !isPendingReview
                  ? 'default'
                  : submission.duplicateConfirmed
                    ? 'warning'
                    : 'danger'
              }
            >
              {submission.duplicateConfirmed
                ? isPendingReview
                  ? '投稿者已确认是不同版本'
                  : '投稿者当时已确认是不同版本'
                : isPendingReview
                  ? '投稿者未确认'
                  : '投稿者当时未确认'}
            </Chip>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p className="text-default-500">
              {isPendingReview
                ? '同一游戏的不同版本可以共用 VNDB ID, 请核对下列条目后判断是否重复收录。'
                : '以下条目与该投稿使用相同 VNDB ID, 供复查历史结论参考。'}
            </p>
            <div className="flex flex-wrap gap-2">
              {submission.vndbDuplicates.map((patch) => (
                <Button
                  key={patch.uniqueId}
                  as={Link}
                  href={`/${patch.uniqueId}`}
                  target="_blank"
                  size="sm"
                  variant="flat"
                >
                  {patch.name || patch.uniqueId}
                </Button>
              ))}
            </div>
            {submission.duplicatesTruncated && (
              <p className="text-xs text-default-500">仅列出前 10 条</p>
            )}
          </CardBody>
        </Card>
      )}

      {preview ? (
        <PatchSubmissionPreviewView
          preview={preview}
          createdAt={submission.created}
        />
      ) : (
        <Card>
          <CardBody>
            <p className="text-sm text-default-500">
              该投稿的正文已经清除或 payload 无法读取，没有可展示的发布预览。
            </p>
          </CardBody>
        </Card>
      )}

      {isPendingReview && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-medium">审核操作</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {isSelfReview && reviewerRole < 4 && (
              <p className="text-sm text-danger">不能审核自己的投稿。</p>
            )}
            {canOverrideSelfReview && (
              <Switch
                isSelected={overrideSelfReview}
                onValueChange={setOverrideSelfReview}
              >
                允许超级管理员自审（操作会写入审计日志）
              </Switch>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                color="success"
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('approve')}
              >
                通过
              </Button>
              <Button
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('request-changes')}
              >
                要求修改
              </Button>
              <Button
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('reject')}
              >
                驳回
              </Button>
              <Button
                color="danger"
                variant="flat"
                isDisabled={
                  isSelfReview &&
                  (!canOverrideSelfReview || !overrideSelfReview)
                }
                onPress={() => openAction('violate')}
              >
                违规
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={pendingAction !== null}
        isDismissable={!working}
        isKeyboardDismissDisabled={working}
        hideCloseButton={working}
        onClose={() => !working && setPendingAction(null)}
      >
        <ModalContent>
          <ModalHeader>
            {pendingAction ? ACTION_LABEL[pendingAction] : ''}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <p className="text-sm text-default-500">
              {pendingAction
                ? ACTION_HINT[pendingAction](submission.heldAmount)
                : ''}
            </p>
            {pendingAction && pendingAction !== 'approve' && (
              <Textarea
                isRequired
                label="原因（会发送给投稿人）"
                maxLength={PATCH_SUBMISSION_REASON_MAX_LENGTH}
                value={reason}
                onValueChange={setReason}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={working}
              onPress={() => setPendingAction(null)}
            >
              取消
            </Button>
            <Button
              color={pendingAction === 'violate' ? 'danger' : 'primary'}
              isLoading={working}
              isDisabled={
                working ||
                (pendingAction !== 'approve' && reason.trim().length === 0)
              }
              onPress={() => void runAction()}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
