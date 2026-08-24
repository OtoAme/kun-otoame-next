'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Progress
} from '@heroui/react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import toast from 'react-hot-toast'
import { generateUUID } from '~/utils/random'
import { kunFetchDelete, kunFetchPost } from '~/utils/kunFetch'
import { emptyPatchSubmissionPayload } from '~/store/patchSubmissionStore'
import type {
  PatchSubmissionQuota,
  PatchSubmissionStatus,
  PatchSubmissionSummary
} from '~/types/api/patchSubmission'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'

const STATUS_LABEL: Record<PatchSubmissionStatus, string> = {
  draft: '编辑中',
  pending: '审核中',
  changes_requested: '需修改',
  rejected: '已驳回',
  published: '已发布',
  violation: '违规关闭',
  deleted: '已删除'
}

const STATUS_COLOR: Record<
  PatchSubmissionStatus,
  'default' | 'primary' | 'warning' | 'success' | 'danger'
> = {
  draft: 'default',
  pending: 'primary',
  changes_requested: 'warning',
  rejected: 'default',
  published: 'success',
  violation: 'danger',
  deleted: 'default'
}

const ACTIVE: PatchSubmissionStatus[] = [
  'draft',
  'pending',
  'changes_requested'
]

const formatMegabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

interface Props {
  submissions: PatchSubmissionSummary[]
  quota: PatchSubmissionQuota
  balance: MoemoepointBalance
}

export const SubmissionList = ({ submissions, quota, balance }: Props) => {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const canCreate = quota.activeCount < quota.maxActive
  const hasEnoughPoints = balance.available >= quota.depositAmount

  const create = async () => {
    setCreating(true)
    try {
      const response = await kunFetchPost<
        string | { submissionId: number }
      >('/patch-submission', {
        // Stable for this attempt, so a retry after a timeout resolves to the
        // draft that was already created instead of holding a second deposit.
        requestId: generateUUID().replace(/-/g, ''),
        payload: { ...emptyPatchSubmissionPayload, name: '未命名投稿' }
      })
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      router.push(`/submission/${response.submissionId}`)
    } catch (error) {
      console.error('Failed to create a submission draft', error)
      toast.error('新建投稿失败, 请检查网络后重试')
    } finally {
      setCreating(false)
    }
  }

  const remove = async (submissionId: number) => {
    const response = await kunFetchDelete<
      string | { moemoepointBalance: MoemoepointBalance | null }
    >(`/patch-submission/${submissionId}`)
    if (typeof response === 'string') {
      toast.error(response)
      return
    }
    toast.success('草稿已删除, 押金已返还')
    router.refresh()
  }

  const hide = async (submissionId: number) => {
    const response = await fetch(`/api/patch-submission/${submissionId}`, {
      method: 'PATCH',
      headers: { 'x-requested-with': 'kun-fetch' }
    })
    const data = (await response.json()) as string | Record<string, never>
    if (typeof data === 'string') {
      toast.error(data)
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <h2 className="text-xl">我的投稿</h2>
          <p className="text-sm text-default-500">
            新建投稿会暂扣 {quota.depositAmount} 萌萌点。通过审核后返还并奖励 3
            点；重复或不予收录会全额返还；违规会扣除。
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Chip variant="flat">
              进行中 {quota.activeCount} / {quota.maxActive}
            </Chip>
            <Chip variant="flat">可用萌萌点 {balance.available}</Chip>
            <Chip variant="flat">暂扣中 {balance.reserved}</Chip>
          </div>

          <div className="space-y-1">
            <Progress
              size="sm"
              aria-label="投稿素材容量"
              value={(quota.usedBytes / quota.maxBytes) * 100}
            />
            <p className="text-tiny text-default-500">
              素材容量 {formatMegabytes(quota.usedBytes)} /{' '}
              {formatMegabytes(quota.maxBytes)} MB
            </p>
          </div>

          {!hasEnoughPoints ? (
            <div className="p-3 space-y-2 text-sm rounded-medium bg-default-100">
              <p>
                可用萌萌点不足 {quota.depositAmount} 点, 暂时无法新建投稿。
              </p>
              <div className="flex gap-2">
                <Button as={Link} href="/user" size="sm" variant="flat">
                  去签到
                </Button>
                <Button
                  as={Link}
                  href="/moemoepoint"
                  size="sm"
                  variant="light"
                >
                  萌萌点规则
                </Button>
              </div>
            </div>
          ) : (
            <Button
              color="primary"
              isDisabled={!canCreate}
              isLoading={creating}
              onPress={() => void create()}
            >
              {canCreate
                ? '新建投稿'
                : `已达 ${quota.maxActive} 条上限, 请先完成或删除`}
            </Button>
          )}
        </CardBody>
      </Card>

      {submissions.length === 0 ? (
        <p className="text-sm text-default-500">还没有投稿记录。</p>
      ) : (
        <div className="space-y-2">
          {submissions.map((submission) => (
            <Card key={submission.id}>
              <CardBody className="flex flex-row flex-wrap items-center gap-3">
                <Chip
                  size="sm"
                  variant="flat"
                  color={STATUS_COLOR[submission.status]}
                >
                  {STATUS_LABEL[submission.status]}
                </Chip>
                <span className="flex-1 min-w-40 truncate">
                  {submission.name}
                </span>

                {submission.reviewReason && (
                  <span className="w-full text-sm text-warning-600">
                    {submission.reviewReason}
                  </span>
                )}

                <div className="flex gap-2 ml-auto">
                  {submission.status === 'published' &&
                  submission.patchUniqueId ? (
                    <Button
                      as={Link}
                      href={`/${submission.patchUniqueId}`}
                      size="sm"
                      variant="flat"
                    >
                      查看条目
                    </Button>
                  ) : (
                    <Button
                      as={Link}
                      href={`/submission/${submission.id}`}
                      size="sm"
                      variant="flat"
                    >
                      查看
                    </Button>
                  )}

                  {ACTIVE.includes(submission.status) ? (
                    submission.status === 'pending' ? null : (
                      <Button
                        size="sm"
                        color="danger"
                        variant="light"
                        onPress={() => void remove(submission.id)}
                      >
                        删除并返还
                      </Button>
                    )
                  ) : (
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => void hide(submission.id)}
                    >
                      从列表隐藏
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
