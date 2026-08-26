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
import { kunFetchPost } from '~/utils/kunFetch'
import { emptyPatchSubmissionPayload } from '~/store/patchSubmissionStore'
import type { PatchSubmissionQuota } from '~/types/api/patchSubmission'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'

const formatMegabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

interface Props {
  quota: PatchSubmissionQuota
  balance: MoemoepointBalance
}

/**
 * The deposit terms for authors who publish through review. Admins never see
 * this panel: they create entries directly and hold no deposit.
 */
export const SubmissionQuotaPanel = ({ quota, balance }: Props) => {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const canCreate = quota.activeCount < quota.maxActive
  const hasEnoughPoints = balance.available >= quota.depositAmount

  const create = async () => {
    setCreating(true)
    try {
      const response = await kunFetchPost<string | { submissionId: number }>(
        '/patch-submission',
        {
          // Stable for this attempt, so a retry after a timeout resolves to the
          // draft that was already created instead of holding a second deposit.
          requestId: generateUUID().replace(/-/g, ''),
          payload: { ...emptyPatchSubmissionPayload, name: '未命名投稿' }
        }
      )
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

  return (
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
            <p>可用萌萌点不足 {quota.depositAmount} 点, 暂时无法新建投稿。</p>
            <div className="flex gap-2">
              <Button as={Link} href="/user" size="sm" variant="flat">
                去签到
              </Button>
              <Button as={Link} href="/moemoepoint" size="sm" variant="light">
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
  )
}
