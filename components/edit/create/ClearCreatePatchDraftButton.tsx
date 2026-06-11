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
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { clearCreatePatchDraftFiles } from '~/utils/createPatchDraft'

interface Props {
  resetData: () => void
  onCleared?: () => void
}

export const ClearCreatePatchDraftButton = ({
  resetData,
  onCleared
}: Props) => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  const handleClear = async () => {
    resetData()
    await clearCreatePatchDraftFiles()
    onCleared?.()
    onClose()
    toast.success('已清除当前编辑信息')
  }

  return (
    <>
      <Button
        color="danger"
        size="sm"
        variant="flat"
        className="min-w-24 justify-center"
        onPress={onOpen}
      >
        <span className="inline-flex items-center justify-center gap-2">
          <Trash2 aria-hidden="true" className="size-4 shrink-0" />
          <span>清除信息</span>
        </span>
      </Button>

      <Modal isOpen={isOpen} onClose={onClose} placement="center">
        <ModalContent>
          <ModalHeader>清除当前编辑信息</ModalHeader>
          <ModalBody>
            <p>将清除当前创建页已填写的信息、封面和画廊草稿。</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              取消
            </Button>
            <Button color="danger" onPress={handleClear}>
              确认清除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
