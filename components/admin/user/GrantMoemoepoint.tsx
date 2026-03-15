'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  Tooltip,
  useDisclosure
} from '@heroui/react'
import { Coins } from 'lucide-react'
import { kunFetchPost } from '~/utils/kunFetch'
import { kunErrorHandler } from '~/utils/kunErrorHandler'
import { useUserStore } from '~/store/userStore'
import type { AdminUser } from '~/types/api/admin'

interface Props {
  user: AdminUser
}

export const GrantMoemoepoint = ({ user }: Props) => {
  const currentUser = useUserStore((state) => state.user)
  const { isOpen, onOpen, onClose } = useDisclosure()

  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [granting, setGranting] = useState(false)

  const handleGrant = async () => {
    const numAmount = Number(amount)
    if (!Number.isInteger(numAmount) || numAmount < 1) {
      toast.error('请输入有效的萌萌点数量')
      return
    }

    setGranting(true)
    const res = await kunFetchPost<KunResponse<{}>>('/admin/user', {
      uid: user.id,
      amount: numAmount,
      reason: reason || undefined
    })
    kunErrorHandler(res, () => {
      toast.success(`成功为 ${user.name} 发放 ${numAmount} 萌萌点`)
    })
    setGranting(false)
    setAmount('')
    setReason('')
    onClose()
  }

  return (
    <>
      <Tooltip content="发放萌萌点">
        <Button
          isIconOnly
          size="sm"
          variant="light"
          color="warning"
          onPress={onOpen}
          isDisabled={currentUser.role < 3}
        >
          <Coins size={16} />
        </Button>
      </Tooltip>

      <Modal size="lg" isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>发放萌萌点: {user.name}</ModalHeader>
          <ModalBody>
            <Input
              label="数量"
              type="number"
              min={1}
              max={100000}
              placeholder="请输入发放数量"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              isRequired
            />
            <Textarea
              label="理由 (可选)"
              placeholder="请输入发放理由"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </ModalBody>
          <ModalFooter>
            <Button color="danger" variant="light" onPress={onClose}>
              取消
            </Button>
            <Button
              color="primary"
              isDisabled={granting || !amount}
              isLoading={granting}
              onPress={handleGrant}
            >
              确认发放
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
