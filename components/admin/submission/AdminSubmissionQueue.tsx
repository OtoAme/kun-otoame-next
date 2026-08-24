'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea
} from '@heroui/react'
import Link from 'next/link'
import { useRouter } from '@bprogress/next'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { PATCH_SUBMISSION_REASON_MAX_LENGTH } from '~/constants/patchSubmission'
import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'

type ReasonedAction = 'reject' | 'request-changes' | 'violate'

const ACTION_LABEL: Record<ReasonedAction, string> = {
  reject: '驳回并返还押金',
  'request-changes': '要求修改',
  violate: '判定违规并扣除押金'
}

const ACTION_HINT: Record<ReasonedAction, string> = {
  reject: '用于重复条目、超出收录范围, 或诚实但无法发布的投稿。押金全额返还。',
  'request-changes': '投稿会回到用户手中继续编辑, 押金保持暂扣, 不做结算。',
  violate: '仅用于违规内容。暂扣的萌萌点将被扣除, 正文与素材会被清除。'
}

interface Props {
  submissions: AdminSubmissionRow[]
  total: number
  query: string
}

export const AdminSubmissionQueue = ({ submissions, total, query }: Props) => {
  const router = useRouter()
  const [search, setSearch] = useState(query)
  const [pending, setPending] = useState<{
    id: number
    action: ReasonedAction
  } | null>(null)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)

  const runAction = async (
    submissionId: number,
    action: 'approve' | ReasonedAction,
    actionReason?: string
  ) => {
    setWorking(true)
    try {
      const response = await kunFetchPost<string | Record<string, unknown>>(
        `/admin/patch-submission/${action}`,
        {
          submissionId,
          ...(actionReason ? { reason: actionReason } : {})
        }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      toast.success(action === 'approve' ? '已通过并发布' : '处理完成')
      setPending(null)
      setReason('')
      router.refresh()
    } catch (error) {
      console.error('Failed to review a submission', error)
      toast.error('操作失败, 请检查网络后重试')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          size="sm"
          label="搜索标题、投稿人或外部 ID"
          value={search}
          onValueChange={setSearch}
        />
        <Button
          size="sm"
          variant="flat"
          onPress={() =>
            router.push(
              `/admin/submission?query=${encodeURIComponent(search.trim())}`
            )
          }
        >
          搜索
        </Button>
        <Chip size="sm" variant="flat">
          待审核 {total}
        </Chip>
      </div>

      {submissions.length === 0 ? (
        <p className="text-sm text-default-500">当前没有待审核的投稿。</p>
      ) : (
        <div className="space-y-2">
          {submissions.map((submission) => (
            <Card key={submission.id}>
              <CardBody className="flex flex-row flex-wrap items-center gap-3">
                <span className="flex-1 min-w-40 truncate">
                  {submission.name}
                </span>
                <Link
                  href={`/user/${submission.authorId}`}
                  className="text-sm text-default-500"
                >
                  {submission.authorName}
                </Link>
                <Chip size="sm" variant="flat">
                  {submission.submittedAt
                    ? new Date(submission.submittedAt).toLocaleString('zh-CN')
                    : '未提交'}
                </Chip>

                <div className="flex flex-wrap gap-2 ml-auto">
                  <Button
                    size="sm"
                    color="success"
                    variant="flat"
                    isDisabled={working}
                    onPress={() => void runAction(submission.id, 'approve')}
                  >
                    通过
                  </Button>
                  {(
                    ['request-changes', 'reject', 'violate'] as ReasonedAction[]
                  ).map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant="light"
                      color={action === 'violate' ? 'danger' : 'default'}
                      isDisabled={working}
                      onPress={() => {
                        setPending({ id: submission.id, action })
                        setReason('')
                      }}
                    >
                      {action === 'reject'
                        ? '驳回'
                        : action === 'violate'
                          ? '违规'
                          : '要求修改'}
                    </Button>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={!!pending} onClose={() => setPending(null)}>
        <ModalContent>
          <ModalHeader>
            {pending ? ACTION_LABEL[pending.action] : ''}
          </ModalHeader>
          <ModalBody className="space-y-2">
            <p className="text-sm text-default-500">
              {pending ? ACTION_HINT[pending.action] : ''}
            </p>
            <Textarea
              isRequired
              label="原因 (会发送给投稿人)"
              maxLength={PATCH_SUBMISSION_REASON_MAX_LENGTH}
              value={reason}
              onValueChange={setReason}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setPending(null)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={working}
              isDisabled={!reason.trim()}
              onPress={() => {
                if (!pending) {
                  return
                }
                void runAction(pending.id, pending.action, reason.trim())
              }}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
