'use client'

import { DropdownItem } from '@heroui/dropdown'
import { Button } from '@heroui/button'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from '@bprogress/next'
import { requestUserLogout } from '~/utils/sessionClient'
import toast from 'react-hot-toast'

export const UserDropdown = () => {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const { isOpen, onOpen, onOpenChange } = useDisclosure()

  const handleLogOut = async () => {
    setLoading(true)
    try {
      const result = await requestUserLogout()
      if (!result) return
      if (result.revoked) toast.success(result.message)
      else toast.error(result.message)
      router.push('/login')
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '退出结果未确认，请检查登录状态后重试'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DropdownItem
        key="logout"
        color="danger"
        startContent={<LogOut className="size-4" />}
        onPress={onOpen}
      >
        退出登录
      </DropdownItem>

      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                您确定要登出网站吗?
              </ModalHeader>
              <ModalBody>
                <p>
                  登出将会清除您的登录状态, 但是不会清除您的编辑草稿 (OtomeGame,
                  回复等), 您可以稍后继续登录
                </p>
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={onClose}>
                  关闭
                </Button>
                <Button
                  color="primary"
                  onPress={() => {
                    handleLogOut()
                    onClose()
                  }}
                  isLoading={loading}
                  disabled={loading}
                >
                  确定
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
