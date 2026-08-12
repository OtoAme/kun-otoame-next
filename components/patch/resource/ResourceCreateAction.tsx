'use client'

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useUserStore } from '~/store/userStore'

interface Props {
  onOpenCreate: () => void
}

export const ResourceCreateAction = ({ onOpenCreate }: Props) => {
  const user = useUserStore((state) => state.user)
  const {
    isOpen: isOpenLoginPrompt,
    onOpen: onOpenLoginPrompt,
    onClose: onCloseLoginPrompt
  } = useDisclosure()

  const isLoggedIn = user.uid > 0

  const handlePress = () => {
    if (!isLoggedIn) {
      onOpenLoginPrompt()
      return
    }

    onOpenCreate()
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Button
          color="primary"
          variant="flat"
          startContent={<Plus className="size-4" />}
          onPress={handlePress}
          aria-label={isLoggedIn ? '添加资源' : '登录后添加资源'}
        >
          {isLoggedIn ? '添加资源' : '登录后添加资源'}
        </Button>
      </div>

      <Modal
        isOpen={isOpenLoginPrompt}
        onClose={onCloseLoginPrompt}
        placement="center"
      >
        <ModalContent>
          <ModalHeader>登录提示</ModalHeader>
          <ModalBody className="space-y-2">
            <p>登录后即可为这款游戏补充下载资源。</p>
            <p className="text-sm text-default-500">
              普通用户满足萌萌点要求后可以发布资源，不需要先成为创作者；提交可能会进入审核。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button as={Link} href="/register" variant="bordered">
              注册账号
            </Button>
            <Button as={Link} href="/login" color="primary">
              登录
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
