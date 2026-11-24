'use client'
import { SettingsCardHeader } from './SettingsHierarchy'

import {
  Card,
  CardBody,
  CardFooter,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import { Button } from '@heroui/button'
import toast from 'react-hot-toast'
import { useRef, useState } from 'react'
import { requestUserLogout } from '~/utils/sessionClient'
import { useUserStore } from '~/store/userStore'

export const Reset = () => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const intent = useRef<{ generation: number; context: string | null } | null>(
    null
  )
  const [loading, setLoading] = useState(false)

  const openConfirmation = () => {
    const session = useUserStore.getState()
    intent.current = {
      generation: session.sessionGeneration,
      context: session.sessionContext
    }
    onOpen()
  }

  const handleResetData = async () => {
    const expected = intent.current
    if (!expected || loading) return
    const session = useUserStore.getState()
    if (
      session.sessionGeneration !== expected.generation ||
      session.sessionContext !== expected.context
    ) {
      onClose()
      toast.error('登录状态已变化，请重新确认清除操作')
      return
    }
    intent.current = null
    setLoading(true)
    try {
      const result = await requestUserLogout({ clearSiteData: true })
      if (!result) {
        toast.error('登录状态已变化，请重新确认清除操作')
        return
      }
      if (!result.revoked) {
        toast.error('本机网站数据已清除，服务端会话撤销暂未确认')
        return
      }
      window.location.replace('/login')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '清除结果未确认，请重试'
      )
    } finally {
      setLoading(false)
      onClose()
    }
  }

  return (
    <Card className="w-full text-sm">
      <SettingsCardHeader>清除网站数据</SettingsCardHeader>
      <CardBody className="py-0 space-y-4">
        <div>
          <p>
            遇到页面异常时，可以清除当前浏览器保存的本站数据，然后重新登录。
          </p>
        </div>
      </CardBody>

      <CardFooter className="flex-wrap">
        <p className="text-danger-500">注意, 清除操作无法撤销</p>

        <Button
          color="danger"
          variant="solid"
          className="ml-auto"
          onPress={openConfirmation}
          isLoading={loading}
        >
          清除
        </Button>
      </CardFooter>

      <Modal
        isOpen={isOpen}
        onClose={onClose}
        placement="center"
        isDismissable={!loading}
        isKeyboardDismissDisabled={loading}
        hideCloseButton={loading}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            您确定要清除网站所有数据吗
          </ModalHeader>
          <ModalBody>
            <p>
              将清除当前浏览器中本站的
              Cookie、本地草稿和设置，以及本标签页的临时数据。清除后需要重新登录。账号资料和已保存到账号的偏好会保留。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              variant="light"
              onPress={onClose}
              isDisabled={loading}
            >
              关闭
            </Button>
            <Button
              isLoading={loading}
              color="primary"
              onPress={handleResetData}
            >
              确定
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  )
}
