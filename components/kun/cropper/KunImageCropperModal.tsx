'use client'

import { useRef, useState } from 'react'
import ReactCrop, { convertToPixelCrop, type Crop } from 'react-image-crop'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { KunCropControls } from './KunCropControls'
import { centerAspectCrop, createCroppedImage } from './utils'
import type { KunAspect } from './types'
import 'react-image-crop/dist/ReactCrop.css'

interface Props {
  isOpen: boolean
  imgSrc: string
  initialAspect?: KunAspect
  description?: string
  onCropComplete?: (croppedImage: string) => void
  onOriginalImageComplete?: (originalImage: string) => void | Promise<void>
  onOpenMosaic: () => void
  onClose: () => void
}

export const KunImageCropperModal = ({
  isOpen,
  imgSrc,
  initialAspect = { x: 16, y: 9 },
  description,
  onCropComplete,
  onOriginalImageComplete,
  onOpenMosaic,
  onClose
}: Props) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<Crop>()
  const [scale, setScale] = useState(1)
  const [rotate, setRotate] = useState(0)
  const [imageReady, setImageReady] = useState(false)
  const [working, setWorking] = useState(false)
  const [renderedSrc, setRenderedSrc] = useState(imgSrc)
  const aspect = initialAspect.x / initialAspect.y

  // The reset has to land before the replacement image's load event, which is
  // what recomputes the crop; a passive effect can flush after that event and
  // leave the modal with no selection at all.
  if (renderedSrc !== imgSrc) {
    setRenderedSrc(imgSrc)
    setCrop(undefined)
    setScale(1)
    setRotate(0)
    setImageReady(false)
  }

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop(centerAspectCrop(width, height, aspect))
    setImageReady(true)
  }

  const handleCropComplete = async () => {
    if (!crop || !imgRef.current) {
      return
    }

    setWorking(true)
    try {
      // Converted at confirm time so the pixels come from the same layout box
      // createCroppedImage scales against: react-image-crop measures the crop
      // the moment it appears, which is while the modal's entrance animation
      // still has the image transform-scaled down.
      const croppedImage = await createCroppedImage(
        imgRef.current,
        convertToPixelCrop(crop, imgRef.current.width, imgRef.current.height),
        scale,
        rotate
      )
      onCropComplete?.(croppedImage)
      // Awaited so the consumer's async compression settles before the modal
      // closes: otherwise switching images in quick succession lets a slower
      // earlier compression land after a faster later one.
      await onOriginalImageComplete?.(imgSrc)
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      scrollBehavior="inside"
      isDismissable={!working}
      isKeyboardDismissDisabled={working}
      hideCloseButton={working}
    >
      <ModalContent>
        <ModalHeader className="flex-col">
          <h2>裁剪图片</h2>
          <p className="font-medium text-medium">{description}</p>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col items-center gap-4">
            {!!imgSrc && (
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                aspect={aspect}
                minHeight={100}
              >
                <img
                  ref={imgRef}
                  alt="Crop me"
                  src={imgSrc}
                  style={{ transform: `scale(${scale}) rotate(${rotate}deg)` }}
                  onLoad={onImageLoad}
                  className="max-h-[60vh] object-contain"
                />
              </ReactCrop>
            )}

            <KunCropControls
              scale={scale}
              rotate={rotate}
              onScaleChange={setScale}
              onRotateChange={setRotate}
              onOpenMosaic={onOpenMosaic}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            color="danger"
            variant="light"
            onPress={onClose}
            isDisabled={working}
          >
            取消
          </Button>
          <Button
            color="primary"
            onPress={handleCropComplete}
            isDisabled={!imageReady || !crop || working}
            isLoading={working}
          >
            裁剪图片
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
