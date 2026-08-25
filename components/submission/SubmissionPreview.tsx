'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader
} from '@heroui/react'
import DOMPurify from 'isomorphic-dompurify'
import toast from 'react-hot-toast'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { NSFWMask } from '~/components/kun/NSFWMask'
import { kunFetchGet } from '~/utils/kunFetch'
import type { PatchSubmissionPublishPreview } from '~/app/api/patch-submission/publishPreview'
import type { PatchSubmissionSaveResult } from '~/hooks/usePatchSubmissionAutosave'

const PreviewGalleryItem = ({
  image,
  onOpen
}: {
  image: PatchSubmissionPublishPreview['gallery'][number]
  onOpen: () => void
}) => {
  const [revealed, setRevealed] = useState(!image.isNSFW)
  if (!image.imageUrl) return null

  return (
    <Button
      isIconOnly
      variant="light"
      aria-label="查看投稿截图"
      className="group relative aspect-video h-auto min-w-0 overflow-hidden rounded-lg bg-default-100 p-0"
      onPress={() => revealed && onOpen()}
    >
      <img
        src={image.thumbnailUrl ?? image.imageUrl}
        alt="投稿截图"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <NSFWMask isVisible={!revealed} onReveal={() => setRevealed(true)} />
    </Button>
  )
}

interface Props {
  submissionId: number
  flush: () => Promise<PatchSubmissionSaveResult>
}

export const SubmissionPreview = ({ submissionId, flush }: Props) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [preview, setPreview] = useState<PatchSubmissionPublishPreview | null>(
    null
  )
  const sanitizedIntroduction = useMemo(
    () => DOMPurify.sanitize(preview?.introductionHtml ?? ''),
    [preview?.introductionHtml]
  )
  const validGallery = preview?.gallery.filter((image) => image.imageUrl) ?? []

  const openPreview = async () => {
    setIsLoading(true)
    try {
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
      >
        <ModalContent>
          <ModalHeader className="flex flex-wrap items-center gap-2">
            <span>{preview?.name || '投稿预览'}</span>
            <Chip color="warning" size="sm" variant="flat">
              预览，尚未提交
            </Chip>
          </ModalHeader>
          <ModalBody className="space-y-6 pb-6">
            {preview && (
              <>
                <div className="flex flex-wrap gap-2">
                  {preview.aliases.map((alias) => (
                    <Chip key={alias} size="sm" variant="flat">
                      {alias}
                    </Chip>
                  ))}
                </div>

                {preview.bannerUrl && (
                  <img
                    src={preview.bannerUrl}
                    alt={`${preview.name} 封面`}
                    className="max-h-[32rem] max-w-full rounded-lg object-contain"
                  />
                )}

                <div
                  className="kun-prose max-w-none rounded-lg bg-content2 p-4"
                  dangerouslySetInnerHTML={{ __html: sanitizedIntroduction }}
                />

                <div className="flex flex-wrap gap-2">
                  {preview.tagNames.map((tag) => (
                    <Chip key={tag} size="sm" color="primary" variant="flat">
                      {tag}
                    </Chip>
                  ))}
                  {preview.companyNames.map((company) => (
                    <Chip key={company} size="sm" variant="bordered">
                      {company}
                    </Chip>
                  ))}
                </div>

                {validGallery.length > 0 && (
                  <KunImageViewer
                    preload={2}
                    images={validGallery.map((image) => ({
                      src: image.imageUrl as string,
                      previewSrc: image.thumbnailUrl ?? undefined,
                      alt: '投稿截图'
                    }))}
                  >
                    {(openLightbox) => (
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        {validGallery.map((image, index) => (
                          <PreviewGalleryItem
                            key={image.id ?? image.imageUrl}
                            image={image}
                            onOpen={() => openLightbox(index)}
                          />
                        ))}
                      </div>
                    )}
                  </KunImageViewer>
                )}
              </>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
