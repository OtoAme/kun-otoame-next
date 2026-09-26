'use client'

import Link from 'next/link'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader
} from '@heroui/react'

interface Props {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** What the visitor tried to do, e.g.「报告问题」. */
  action: string
}

/** Guests see every entry and get this prompt only when they try to submit (D22). */
export const CaseLoginPrompt = ({ isOpen, onOpenChange, action }: Props) => (
  <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
    <ModalContent>
      <ModalHeader>请先登录</ModalHeader>
      <ModalBody className="pb-6">
        <p className="text-sm text-default-500">
          {action}需要先登录账号，提交后可以在「问题处理」页跟进进度。
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
)
