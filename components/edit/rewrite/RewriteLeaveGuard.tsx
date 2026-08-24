'use client'

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { useRouter } from '@bprogress/next'
import { useLeaveConfirm } from '~/hooks/useLeaveConfirm'

interface Props {
  enabled: boolean
  description: string
}

export const RewriteLeaveGuard = ({ enabled, description }: Props) => {
  const router = useRouter()
  const { pendingHref, cancelNavigation } = useLeaveConfirm(enabled)

  const handleLeave = () => {
    if (!pendingHref) {
      return
    }
    const href = pendingHref
    cancelNavigation()
    router.push(href)
  }

  return (
    <Modal
      isOpen={!!pendingHref}
      onClose={cancelNavigation}
      placement="center"
    >
      <ModalContent>
        <ModalHeader>离开后未上传的图片会丢失</ModalHeader>
        <ModalBody>
          <p>{description}</p>
          <p className="text-sm text-default-500">
            重新进入编辑页会从当前已保存的内容开始，这些文件需要重新选择。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={cancelNavigation}>
            留在本页
          </Button>
          <Button color="danger" onPress={handleLeave}>
            仍然离开
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
