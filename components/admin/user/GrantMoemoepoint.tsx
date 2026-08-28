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
import { generateUUID } from '~/utils/random'
import { useUserStore } from '~/store/userStore'
import type { AdminUser } from '~/types/api/admin'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'

interface Props {
  user: AdminUser
}

interface PendingRequest {
  requestId: string
  amount: number
  reason?: string
}

type GrantResult = {
  balance: MoemoepointBalance
  applied: boolean
}

export const GrantMoemoepoint = ({ user }: Props) => {
  const currentUser = useUserStore((state) => state.user)
  const setMoemoepointBalance = useUserStore(
    (state) => state.setMoemoepointBalance
  )
  const { isOpen, onOpen, onClose } = useDisclosure()

  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [granting, setGranting] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(
    null
  )

  const resetForm = () => {
    setAmount('')
    setReason('')
    setPendingRequest(null)
  }

  const handleOpen = () => {
    setRequestId(generateUUID())
    onOpen()
  }

  const handleClose = () => {
    if (granting) {
      return
    }
    resetForm()
    onClose()
  }

  const handleGrant = async () => {
    const numAmount = Number(amount)
    if (!Number.isInteger(numAmount) || numAmount < 1) {
      toast.error('请输入有效的萌萌点数量')
      return
    }

    // 结果不明的请求必须原样重发, 换一个 requestId 或改一个参数都会变成第二笔钱。
    const request: PendingRequest = pendingRequest ?? {
      requestId,
      amount: numAmount,
      reason: reason || undefined
    }

    setGranting(true)
    let res: KunResponse<GrantResult>
    try {
      res = await kunFetchPost<KunResponse<GrantResult>>('/admin/user', {
        uid: user.id,
        requestId: request.requestId,
        amount: request.amount,
        reason: request.reason
      })
    } catch {
      setPendingRequest(request)
      toast.error(
        '网络异常, 发放结果未知。请点击"重试原请求"确认, 或关闭弹窗后前往用户账单核对。'
      )
      return
    } finally {
      setGranting(false)
    }

    kunErrorHandler(res, (value) => {
      if (user.id === currentUser.uid) {
        setMoemoepointBalance(value.balance)
      }
      toast.success(
        value.applied
          ? `成功为 ${user.name} 发放 ${request.amount} 萌萌点`
          : '该请求此前已生效, 未重复发放'
      )
      resetForm()
      onClose()
    })
  }

  return (
    <>
      <Tooltip content="发放萌萌点">
        <Button
          isIconOnly
          size="sm"
          variant="light"
          color="warning"
          onPress={handleOpen}
          isDisabled={currentUser.role < 3}
          aria-label={`为 ${user.name} 发放萌萌点`}
        >
          <Coins size={16} />
        </Button>
      </Tooltip>

      <Modal
        size="lg"
        isOpen={isOpen}
        onClose={handleClose}
        isDismissable={!granting}
        isKeyboardDismissDisabled={granting}
        hideCloseButton={granting}
      >
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
              isDisabled={!!pendingRequest}
              isRequired
            />
            <Textarea
              label="理由 (可选)"
              placeholder="请输入发放理由"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              isDisabled={!!pendingRequest}
              maxLength={500}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              variant="light"
              onPress={handleClose}
              isDisabled={granting}
            >
              取消
            </Button>
            <Button
              color="primary"
              isDisabled={granting || !amount}
              isLoading={granting}
              onPress={handleGrant}
            >
              {pendingRequest ? '重试原请求' : '确认发放'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
