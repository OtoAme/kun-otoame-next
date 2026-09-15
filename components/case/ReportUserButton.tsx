'use client'

import { useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import { useUserStore } from '~/store/userStore'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_REPORT_MIN_LENGTH
} from '~/constants/case'
import type { CaseCreateResponse } from '~/types/api/case'

interface Props {
  targetUserId: number
  targetUserName: string
}

export const ReportUserButton = ({ targetUserId, targetUserName }: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user.uid < 1 || user.uid === targetUserId) {
    return null
  }

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (trimmed.length < CASE_REPORT_MIN_LENGTH || submitting) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: 'content_violation',
        targetType: 'user',
        targetId: targetUserId,
        content: trimmed
      })
      if (typeof res === 'string') {
        toast.error(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        toast('相同举报刚刚结案，请重新提交')
        return
      }
      toast.success(
        res.created
          ? '举报已提交，处理结果可在「问题处理」页查看'
          : res.subscribed
            ? '你已提交过对该用户的举报，正在处理中'
            : '已登记，正在处理'
      )
      setContent('')
      onClose()
    } catch {
      toast.error('网络错误，提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        variant="flat"
        color="danger"
        fullWidth
        startContent={<Flag className="size-4" />}
        onPress={onOpen}
      >
        举报
      </Button>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">举报用户</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">
              举报 {targetUserName}{' '}
              的违规行为。违规举报由站方处理，预计首次响应在 3
              天内，处理进度和结果可在「问题处理」页查看。
            </p>
            <Textarea
              aria-label="举报原因"
              isRequired
              placeholder={`请填写举报原因（至少 ${CASE_REPORT_MIN_LENGTH} 个字符，纯文字）`}
              value={content}
              onValueChange={setContent}
              maxLength={CASE_CONTENT_MAX_LENGTH}
              isInvalid={
                content.length > 0 &&
                content.trim().length < CASE_REPORT_MIN_LENGTH
              }
              errorMessage={`举报原因最少 ${CASE_REPORT_MIN_LENGTH} 个字符`}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose} isDisabled={submitting}>
              取消
            </Button>
            <Button
              color="primary"
              onPress={() => void handleSubmit()}
              isDisabled={
                content.trim().length < CASE_REPORT_MIN_LENGTH || submitting
              }
              isLoading={submitting}
            >
              提交
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
