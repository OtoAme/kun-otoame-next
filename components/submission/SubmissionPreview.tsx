'use client'

import { useState } from 'react'
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader
} from '@heroui/react'
import toast from 'react-hot-toast'
import { kunFetchGet } from '~/utils/kunFetch'
import { PatchSubmissionPreviewView } from './PatchSubmissionPreviewView'
import type { PatchSubmissionPublishPreview } from '~/app/api/patch-submission/publishPreview'
import type { PatchSubmissionSaveResult } from '~/hooks/usePatchSubmissionAutosave'

interface Props {
  submissionId: number
  flush: () => Promise<PatchSubmissionSaveResult>
}

export const SubmissionPreview = ({ submissionId, flush }: Props) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [preview, setPreview] = useState<PatchSubmissionPublishPreview | null>(
    null
  )

  const openPreview = async () => {
    setIsLoading(true)
    try {
      // The draft must reach the server first, or the private projection would
      // render a stale version.
      const saved = await flush()
      if (!saved.ok) {
        toast.error(saved.message)
        return
      }

      const response = await kunFetchGet<
        string | PatchSubmissionPublishPreview
      >(`/patch-submission/${submissionId}/preview`)
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      setPreview(response)
      setIsOpen(true)
    } catch (error) {
      console.error('Failed to load the submission preview', error)
      toast.error('预览加载失败，请检查网络后重试')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="flat"
        isLoading={isLoading}
        onPress={() => void openPreview()}
      >
        预览
      </Button>

      <Modal
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        size="5xl"
        scrollBehavior="inside"
        // While the gallery lightbox is open it portals on top of this modal;
        // a click on its backdrop is "outside" the modal and would otherwise
        // dismiss the preview too. Hold the modal open until the lightbox closes.
        isDismissable={!lightboxOpen}
        isKeyboardDismissDisabled={lightboxOpen}
      >
        <ModalContent>
          <ModalHeader className="flex flex-wrap items-center gap-2">
            <span>{preview?.name || '投稿预览'}</span>
            <Chip color="warning" size="sm" variant="flat">
              预览，尚未提交
            </Chip>
          </ModalHeader>
          <ModalBody className="pb-6">
            {preview && (
              <PatchSubmissionPreviewView
                preview={preview}
                onLightboxOpenChange={setLightboxOpen}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
