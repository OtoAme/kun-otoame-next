'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/button'
import { Textarea } from '@heroui/input'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import { Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import { kunFetchPost } from '~/utils/kunFetch'

interface Props {
  shoutboxId: number
  authorId: number
}

/**
 * Report entry for a single shoutbox message, shared by the full card and the
 * compact rows. The author's own message never shows it; guests get the
 * existing login prompt instead of the report form. A failed or refused
 * submission keeps the draft so it can be adjusted and retried.
 */
export const ShoutboxReportButton = ({ shoutboxId, authorId }: Props) => {
  const mounted = useMounted()
  const currentUserId = useUserStore((state) => state.user.uid)
  const reportModal = useDisclosure()
  const loginModal = useDisclosure()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const lockRef = useRef(false)

  // Own-check needs the persisted user: render nothing until mounted to avoid
  // hydration drift, and never for the author.
  if (!mounted || (currentUserId > 0 && currentUserId === authorId)) {
    return null
  }

  const handleClick = () => {
    if (currentUserId > 0) {
      reportModal.onOpen()
    } else {
      loginModal.onOpen()
    }
  }

  const handleSubmit = async () => {
    const content = reason.trim()
    if (content.length < 2) {
      setReasonError('举报原因最少 2 个字符')
      return
    }
    if (content.length > 5000) {
      setReasonError('举报原因最多 5000 个字符')
      return
    }
    if (lockRef.current) {
      return
    }
    lockRef.current = true
    setSubmitting(true)
    try {
      const response = await kunFetchPost<KunResponse<{}>>('/shoutbox/report', {
        shoutboxId,
        content
      })
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      toast.success('举报已提交，站方会进行复核')
      setReason('')
      setReasonError('')
      reportModal.onClose()
    } catch {
      toast.error('举报提交失败，请稍后重试')
    } finally {
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="light"
        startContent={<Flag className="size-3.5" />}
        onPress={handleClick}
      >
        举报
      </Button>

      <Modal
        isOpen={reportModal.isOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            reportModal.onClose()
          }
        }}
        placement="center"
      >
        <ModalContent>
          <ModalHeader>举报小喇叭</ModalHeader>
          <ModalBody>
            <Textarea
              aria-label="举报原因"
              placeholder="请说明举报原因，站方会进行复核"
              value={reason}
              onValueChange={(value) => {
                setReason(value)
                setReasonError('')
              }}
              maxLength={5000}
              isDisabled={submitting}
              isInvalid={reasonError !== ''}
              errorMessage={reasonError}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={reportModal.onClose}
              isDisabled={submitting}
            >
              取消
            </Button>
            <Button
              color="primary"
              onPress={handleSubmit}
              isLoading={submitting}
            >
              提交举报
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={loginModal.isOpen}
        onOpenChange={loginModal.onOpenChange}
        placement="center"
      >
        <ModalContent>
          <ModalHeader>请先登录</ModalHeader>
          <ModalBody className="pb-6">
            <p className="text-sm text-default-500">
              举报小喇叭需要先登录账号。
            </p>
            <div className="mt-3 flex gap-2">
              <Button as={Link} href="/login" color="primary">
                登录
              </Button>
              <Button as={Link} href="/register" variant="bordered">
                注册
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
