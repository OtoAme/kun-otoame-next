'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import toast from 'react-hot-toast'
import { kunFetchDelete } from '~/utils/kunFetch'
import { clearPatchSubmissionDraftStorage } from '~/utils/patchSubmissionUploadDraft'
import { cn } from '~/utils/cn'
import type {
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

const miniBanner = (url: string | null) =>
  url ? url.replace(/\.avif$/, '-mini.avif') : '/otoame.avif'

interface Props {
  submissions: PatchSubmissionSummary[]
}

export const SubmissionList = ({ submissions }: Props) => {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] =
    useState<PatchSubmissionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!pendingDelete) {
      return
    }
    setDeleting(true)
    try {
      const response = await kunFetchDelete<
        string | { moemoepointBalance: MoemoepointBalance | null }
      >(`/patch-submission/${pendingDelete.id}`)
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      // The server cannot reach this browser's localforage, so the draft's
      // pending uploads and options are only clearable from here.
      await clearPatchSubmissionDraftStorage(pendingDelete.id).catch((error) =>
        console.error('Failed to clear submission draft storage', error)
      )
      toast.success('草稿已删除, 押金已返还')
      setPendingDelete(null)
      router.refresh()
    } catch (error) {
      console.error('Failed to delete a submission draft', error)
      toast.error('删除失败, 请检查网络后重试')
    } finally {
      setDeleting(false)
    }
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
      {submissions.length === 0 ? (
        <p className="text-sm text-default-500">还没有进行中的投稿。</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {submissions.map((submission) => {
            const isActive = ACTIVE.includes(submission.status)

            return (
              <Card
                key={submission.id}
                className="border border-default-100 dark:border-default-200"
              >
                <CardBody className="p-0">
                  <div className="relative aspect-video overflow-hidden bg-default-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={miniBanner(submission.bannerUrl)}
                      alt={submission.name}
                      className="size-full object-cover"
                    />
                    <Chip
                      size="sm"
                      variant="solid"
                      color={STATUS_COLOR[submission.status]}
                      className={cn(
                        'absolute left-2 top-2',
                        STATUS_COLOR[submission.status] === 'default' &&
                          'bg-default-200/90 text-default-700'
                      )}
                    >
                      {STATUS_LABEL[submission.status]}
                    </Chip>
                  </div>
                </CardBody>
                <CardFooter className="flex-col items-start gap-2">
                  <span
                    className="line-clamp-1 font-medium"
                    title={submission.name}
                  >
                    {submission.name || '未命名投稿'}
                  </span>
                  {submission.reviewReason && (
                    <span className="line-clamp-2 text-tiny text-warning-600">
                      {submission.reviewReason}
                    </span>
                  )}
                  <div className="flex w-full flex-wrap gap-2">
                    <Button
                      as={Link}
                      href={`/submission/${submission.id}`}
                      size="sm"
                      variant="flat"
                      className="flex-1"
                    >
                      {isActive ? '继续编辑' : '查看'}
                    </Button>

                    {isActive ? (
                      submission.status === 'pending' ? null : (
                        <Button
                          size="sm"
                          color="danger"
                          variant="light"
                          onPress={() => setPendingDelete(submission)}
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
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => !deleting && setPendingDelete(null)}
      >
        <ModalContent>
          <ModalHeader>删除草稿</ModalHeader>
          <ModalBody>
            <p className="text-sm">
              确定删除《{pendingDelete?.name || '未命名投稿'}
              》吗？删除后草稿不可恢复
              {pendingDelete?.heldAmount
                ? `, 暂扣的 ${pendingDelete.heldAmount} 萌萌点会返还`
                : ''}
              。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={deleting}
              onPress={() => setPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              color="danger"
              isLoading={deleting}
              onPress={() => void confirmDelete()}
            >
              删除并返还
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
