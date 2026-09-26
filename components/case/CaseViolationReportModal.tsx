'use client'

import { useRef, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea
} from '@heroui/react'
import toast from 'react-hot-toast'
import { kunFetchPost } from '~/utils/kunFetch'
import {
  CASE_CONTENT_MAX_LENGTH,
  CASE_REPORT_MIN_LENGTH
} from '~/constants/case'
import { CaseImageField } from './CaseImageField'
import { CaseSubmitResult } from './CaseSubmitResult'
import { useCaseImageUploads } from './useCaseImageUploads'
import type { CaseCreateResponse } from '~/types/api/case'

export type CaseViolationTarget =
  | { targetType: 'user'; targetId: number }
  | {
      targetType: 'comment' | 'rating' | 'shoutbox'
      targetId: number
      expectedPatchId?: number
    }

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Modal header, e.g.「举报评论」. */
  title: string
  /** Names what is reported, e.g. the first characters of the comment. */
  subject: string
  target: CaseViolationTarget
  /** Runs after a successful submission, e.g. to refresh a public list. */
  onSubmitted?: () => void
}

/**
 * The violation report form behind the comment, rating, shoutbox and user
 * entries. It posts straight to the case API so every entry shows who handles
 * it, the first-response time and a result with a direct link (D22).
 */
export const CaseViolationReportModal = ({
  isOpen,
  onClose,
  title,
  subject,
  target,
  onSubmitted
}: Props) => {
  const uploads = useCaseImageUploads()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CaseCreateResponse | null>(null)
  const lockRef = useRef(false)
  const tooShort = content.trim().length < CASE_REPORT_MIN_LENGTH

  const handleClose = () => {
    if (submitting) return
    // 提交成功后收起即清空；取消时保留草稿
    if (result) {
      setResult(null)
      setContent('')
      uploads.reset()
    }
    onClose()
  }

  const handleSubmit = async () => {
    if (tooShort || uploads.uploading || lockRef.current) return
    lockRef.current = true
    setSubmitting(true)
    try {
      const res = await kunFetchPost<CaseCreateResponse | string>('/case', {
        kind: 'content_violation',
        ...target,
        content: content.trim(),
        imageKeys: uploads.keys
      })
      if (typeof res === 'string') {
        // 业务失败保留输入，便于修改后重试
        toast.error(res || '提交失败，请稍后重试')
        return
      }
      if (res.justClosed) {
        toast('相同举报刚刚结案，请重新提交')
        return
      }
      setResult(res)
      onSubmitted?.()
    } catch {
      toast.error('网络错误，提交失败，请重试')
    } finally {
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      placement="center"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">{title}</ModalHeader>
        <ModalBody>
          {result ? (
            <CaseSubmitResult
              result={result}
              handler="网站管理员，预计 3 天内首次回应"
            />
          ) : (
            <>
              <p className="text-sm text-default-500">
                {subject}
                违规举报由网站管理员处理，预计首次响应在 3
                天内；被举报的用户看不到你的举报。
              </p>
              <Textarea
                aria-label="举报原因"
                isRequired
                placeholder={`请填写举报原因（至少 ${CASE_REPORT_MIN_LENGTH} 个字符，纯文字）`}
                value={content}
                onValueChange={setContent}
                maxLength={CASE_CONTENT_MAX_LENGTH}
                isDisabled={submitting}
                isInvalid={content.length > 0 && tooShort}
                errorMessage={`举报原因最少 ${CASE_REPORT_MIN_LENGTH} 个字符`}
              />
              <CaseImageField uploads={uploads} isDisabled={submitting} />
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {result ? (
            <Button variant="light" onPress={handleClose}>
              关闭
            </Button>
          ) : (
            <>
              <Button
                variant="light"
                onPress={handleClose}
                isDisabled={submitting}
              >
                取消
              </Button>
              <Button
                color="primary"
                onPress={() => void handleSubmit()}
                isDisabled={tooShort || uploads.uploading}
                isLoading={submitting}
              >
                提交举报
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
