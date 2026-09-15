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
  CASE_DESCRIPTION_MIN_LENGTH
} from '~/constants/case'
import type { CaseCreateResponse } from '~/types/api/case'
import type { PatchResource } from '~/types/api/patch'

interface Props {
  resource: PatchResource
  /** 当前页面所属条目 ID，随请求作为 expectedPatchId 校验资源是否已被移动。 */
  patchId: number
}

export const ReportResourceButton = ({ resource, patchId }: Props) => {
  const { user } = useUserStore((state) => state)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user.uid < 1) {
    return null
  }

  // 与资源 Tabs 官方/社区同一口径：作者 role > 2 视为官方资源，归站方处理。
  const official = (resource.user?.role ?? 0) > 2
  const handlerHint = official
    ? '该问题由站方处理，预计首次响应在 7 天内。'
    : '该问题先由资源发布者处理，预计首次响应在 7 天内；若发布者 7 天未处理，会自动升级给站方。'

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (trimmed.length < CASE_DESCRIPTION_MIN_LENGTH || submitting) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: resource.id,
        expectedPatchId: patchId,
        content: trimmed
      })
      if (typeof res === 'string') {
        // 业务失败（日限额、资源已被移动等）保留输入
        toast.error(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        toast('相同问题刚刚结案，请重新提交')
        return
      }
      // created=false 且 subscribed=false 的幂等成功也按成功收起
      toast.success(
        res.created
          ? '已提交，可在「问题处理」页跟进进度'
          : res.subscribed
            ? '该资源已有相同问题正在处理，已为你登记关注'
            : '已登记，正在处理'
      )
      setContent('')
      onClose()
    } catch {
      // 网络失败保留输入
      toast.error('网络错误，提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="light"
        startContent={<Flag className="size-4" />}
        onPress={onOpen}
      >
        报告问题
      </Button>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">报告问题</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">
              资源与描述不符（{resource.name}）。{handlerHint}
              处理进度和结果可在「问题处理」页查看。
            </p>
            <Textarea
              aria-label="问题描述"
              isRequired
              placeholder={`请描述实际内容与资源描述不符的地方（至少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符，纯文字）`}
              value={content}
              onValueChange={setContent}
              maxLength={CASE_CONTENT_MAX_LENGTH}
              isInvalid={
                content.length > 0 &&
                content.trim().length < CASE_DESCRIPTION_MIN_LENGTH
              }
              errorMessage={`问题描述最少 ${CASE_DESCRIPTION_MIN_LENGTH} 个字符`}
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
                content.trim().length < CASE_DESCRIPTION_MIN_LENGTH ||
                submitting
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
