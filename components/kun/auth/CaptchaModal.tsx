'use client'

import toast from 'react-hot-toast'
import { useEffect, useState } from 'react'
import {
  Button,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { kunFetchGet, kunFetchPost } from '~/utils/kunFetch'
import { KunCaptchaCanvas } from './CaptchaCanvas'
import { KunLoading } from '../Loading'
import { kunCaptchaErrorMessageMap } from '~/constants/captcha'
import type { KunCaptchaImage } from './captcha'

interface CaptchaModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (code: string) => void | Promise<void>
}

export const KunCaptchaModal = ({
  isOpen,
  onClose,
  onSuccess
}: CaptchaModalProps) => {
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set())
  const [images, setImages] = useState<KunCaptchaImage[]>([])
  const [sessionId, setSessionId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [errorCount, setErrorCount] = useState(0)

  useEffect(() => {
    if (isOpen) {
      loadCaptcha()
    }
  }, [isOpen])

  const loadCaptcha = async () => {
    if (errorCount < 6) {
      setErrorCount((prev) => prev + 1)
    }

    setLoading(true)
    setVerifying(false)
    setVerified(false)
    const { images, sessionId } = await kunFetchGet<{
      images: KunCaptchaImage[]
      sessionId: string
    }>('/auth/captcha')

    setImages(images)
    setSessionId(sessionId)
    setSelectedImages(new Set())

    setLoading(false)
  }

  const toggleImageSelection = (id: string) => {
    if (verifying || verified) {
      return
    }

    const newSelection = new Set(selectedImages)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    setSelectedImages(newSelection)
  }

  const handleVerify = async () => {
    if (verifying || verified) {
      return
    }

    setVerifying(true)
    try {
      const response = await kunFetchPost<KunResponse<{ code: string }>>(
        '/auth/captcha',
        { sessionId, selectedIds: Array.from(selectedImages) }
      )
      if (typeof response === 'string') {
        toast.error(kunCaptchaErrorMessageMap[errorCount])
        await loadCaptcha()
      } else {
        setVerified(true)
        await onSuccess(response.code)
      }
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      isDismissable={!verifying && !verified}
      isKeyboardDismissDisabled={verifying || verified}
    >
      <ModalContent>
        <ModalHeader className="flex-col">
          <h3 className="text-lg">人机验证</h3>
          <p className="font-medium">请选择下面所有的 白毛 男孩子</p>
        </ModalHeader>
        <ModalBody>
          {loading ? (
            <KunLoading hint="正在加载验证..." />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {images.map((image) => (
                  <div key={image.id} className="aspect-square">
                    <KunCaptchaCanvas
                      image={image}
                      isSelected={selectedImages.has(image.id)}
                      onSelect={() => toggleImageSelection(image.id)}
                    />
                  </div>
                ))}
              </div>

              {(verifying || verified) && (
                <p className="text-sm text-default-500">
                  {verified
                    ? '验证通过，正在继续处理，请稍候。'
                    : '正在验证，请稍候，不要重复提交。'}
                </p>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            color="danger"
            variant="light"
            onPress={onClose}
            isDisabled={verifying || verified}
          >
            取消
          </Button>
          <Button
            color="primary"
            onPress={handleVerify}
            isDisabled={selectedImages.size === 0 || verifying || verified}
            isLoading={verifying}
          >
            {verified ? '验证通过...' : verifying ? '正在验证...' : '确定'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
