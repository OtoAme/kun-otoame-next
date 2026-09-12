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
import { Tooltip } from '@heroui/tooltip'
import { Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import { kunFetchPost } from '~/utils/kunFetch'
import { notifyShoutboxPublicWrite } from './query/core'
import { useShoutboxQueryContextOrNull } from './query/ShoutboxQueryProvider'

interface Props {
  shoutboxId: number
  authorId: number
  /**
   * Server-computed from the author's current role: false on every message
   * by a super administrator (role 4), ordinary or official alike. It gates
   * only the report flow — the role >= 3 review navigation below stays
   * available on those messages.
   */
  reportable: boolean
  /** Compact rows use an icon-only trigger with an accessible name. */
  isIconOnly?: boolean
}

/**
 * Right-side entry for a single shoutbox message, shared by the full card
 * and the compact rows. The author's own message never shows it — for
 * administrators either. Administrators (role >= 3) get a same-size review
 * entry on other people's messages that only navigates to the dashboard's
 * targeted view and never submits a report; everyone else gets the report
 * form, and guests the existing login prompt. A message the server marks
 * not reportable renders no report entry at all — without the entry there
 * is no path that could submit such a report. A failed or refused
 * submission keeps the draft so it can be adjusted and retried.
 */
export const ShoutboxReportButton = ({
  shoutboxId,
  authorId,
  reportable,
  isIconOnly = false
}: Props) => {
  const mounted = useMounted()
  const currentUserId = useUserStore((state) => state.user.uid)
  const role = useUserStore((state) => state.user.role)
  const reportModal = useDisclosure()
  const loginModal = useDisclosure()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const lockRef = useRef(false)
  const shoutboxQuery = useShoutboxQueryContextOrNull()

  // Own-check needs the persisted user: render nothing until mounted to avoid
  // hydration drift, and never for the author.
  if (!mounted || (currentUserId > 0 && currentUserId === authorId)) {
    return null
  }

  if (role >= 3) {
    const href = `/dashboard/shoutbox?shoutbox=${shoutboxId}`
    const review = isIconOnly ? (
      <Button
        size="sm"
        variant="light"
        isIconOnly
        as={Link}
        href={href}
        aria-label="审查小喇叭"
      >
        <Flag className="size-3.5" />
      </Button>
    ) : (
      <Button
        size="sm"
        variant="light"
        as={Link}
        href={href}
        startContent={<Flag className="size-3.5" />}
      >
        审查小喇叭
      </Button>
    )
    return isIconOnly ? (
      <Tooltip content="审查小喇叭">{review}</Tooltip>
    ) : (
      review
    )
  }

  // Ordinary users and guests: a non-reportable message gets no entry at
  // all (not even the login prompt), so nothing here can reach the report
  // API for it.
  if (!reportable) {
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
      void notifyShoutboxPublicWrite(shoutboxQuery)
      reportModal.onClose()
    } catch {
      toast.error('举报提交失败，请稍后重试')
    } finally {
      lockRef.current = false
      setSubmitting(false)
    }
  }

  const trigger = isIconOnly ? (
    <Button
      size="sm"
      variant="light"
      isIconOnly
      aria-label="举报"
      onPress={handleClick}
    >
      <Flag className="size-3.5" />
    </Button>
  ) : (
    <Button
      size="sm"
      variant="light"
      startContent={<Flag className="size-3.5" />}
      onPress={handleClick}
    >
      举报
    </Button>
  )

  return (
    <>
      {isIconOnly ? <Tooltip content="举报">{trigger}</Tooltip> : trigger}

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
