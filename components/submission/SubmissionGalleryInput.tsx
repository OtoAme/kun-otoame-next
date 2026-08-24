'use client'

import { useEffect, useState } from 'react'
import { Button, Card, CardBody, Checkbox, Chip } from '@heroui/react'
import { Maximize2, Trash2, Upload } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { checkImageValid } from '~/utils/resizeImage'
import { generateUUID } from '~/utils/random'
import { kunFetchFormData } from '~/utils/kunFetch'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { getGalleryFilesFromEvent } from '~/utils/galleryDrop'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import { PATCH_SUBMISSION_GALLERY_MAX_COUNT } from '~/constants/patchSubmission'
import { cn } from '~/utils/cn'
import type { PatchSubmissionGalleryImage } from '~/types/api/patchSubmission'

interface CardProps {
  image: PatchSubmissionGalleryImage
  index: number
  selected: boolean
  onToggle: () => void
  onOpenLightbox: () => void
  onDelete: () => void
}

/**
 * Selecting and zooming are separate focusable controls with real accessible
 * names, instead of one card that swallows both. The editor's own gallery makes
 * the whole card the click target with a pointer-events-none checkbox, which
 * leaves keyboard users unable to select or zoom anything; submissions are aimed
 * at ordinary users, so that is not carried over here.
 */
const SubmissionGalleryCard = ({
  image,
  index,
  selected,
  onToggle,
  onOpenLightbox,
  onDelete
}: CardProps) => {
  const label = `第 ${index + 1} 张截图`

  return (
    <Card
      className={cn(
        'relative',
        selected && 'ring-2 ring-primary',
        image.isNSFW && 'border-2 border-danger'
      )}
    >
      <CardBody className="p-2 space-y-2">
        {image.thumbnailUrl || image.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.thumbnailUrl ?? image.imageUrl ?? ''}
            alt={label}
            className="object-cover w-full rounded-medium aspect-video"
          />
        ) : (
          <div className="flex items-center justify-center w-full text-sm bg-default-100 rounded-medium aspect-video text-default-500">
            上传中
          </div>
        )}

        <div className="flex items-center justify-between gap-1">
          <Checkbox
            size="sm"
            isSelected={selected}
            onValueChange={onToggle}
            aria-label={`选择${label}`}
          >
            <span className="text-tiny">选择</span>
          </Checkbox>

          <div className="flex gap-1">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              onPress={onOpenLightbox}
              aria-label={`放大查看${label}`}
            >
              <Maximize2 className="size-4" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              onPress={onDelete}
              aria-label={`删除${label}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {image.uploadStatus === 'failed' && (
          <Chip size="sm" color="danger" variant="flat">
            上传失败, 请重新选择
          </Chip>
        )}
      </CardBody>
    </Card>
  )
}

export const SubmissionGalleryInput = () => {
  const { submissionId, gallery, setGallery, status } =
    usePatchSubmissionStore()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [uploading, setUploading] = useState(0)
  const editable = status === 'draft' || status === 'changes_requested'

  useEffect(() => {
    setSelected(new Set())
  }, [submissionId])

  const readyCount = gallery.filter(
    (image) => image.uploadStatus !== 'failed'
  ).length

  const uploadOne = async (file: File, displayOrder: number) => {
    const formData = new FormData()
    formData.set('submissionId', String(submissionId))
    // Stable per file, so a retry after a timeout lands on the same row instead
    // of adding a duplicate.
    formData.set('clientAssetId', generateUUID().replace(/-/g, ''))
    formData.set('image', file)
    formData.set('displayOrder', String(displayOrder))

    const response = await kunFetchFormData<
      string | { galleryId: number; alreadyUploaded: boolean }
    >('/patch-submission/asset', formData)

    if (typeof response === 'string') {
      toast.error(response)
      return false
    }
    return true
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    getFilesFromEvent: getGalleryFilesFromEvent,
    accept: { 'image/*': [] },
    disabled: !editable,
    onDrop: async (accepted: File[]) => {
      const valid = accepted.filter((file) => checkImageValid(file))
      if (!valid.length) {
        return
      }
      if (readyCount + valid.length > PATCH_SUBMISSION_GALLERY_MAX_COUNT) {
        toast.error(`截图最多 ${PATCH_SUBMISSION_GALLERY_MAX_COUNT} 张`)
        return
      }

      setUploading((count) => count + valid.length)
      let uploaded = 0
      for (const [offset, file] of valid.entries()) {
        if (await uploadOne(file, readyCount + offset)) {
          uploaded += 1
        }
        setUploading((count) => count - 1)
      }

      if (uploaded) {
        await refresh()
      }
    }
  })

  const refresh = async () => {
    const response = await fetch(`/api/patch-submission/${submissionId}`, {
      headers: { 'x-requested-with': 'kun-fetch' }
    })
    const data = (await response.json()) as
      | string
      | { gallery: PatchSubmissionGalleryImage[] }
    if (typeof data !== 'string') {
      setGallery(data.gallery)
    }
  }

  const deleteImage = async (galleryId: number) => {
    const response = await fetch('/api/patch-submission/asset', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'kun-fetch'
      },
      body: JSON.stringify({ submissionId, galleryId })
    })
    const data = (await response.json()) as string | Record<string, never>
    if (typeof data === 'string') {
      toast.error(data)
      return
    }
    setGallery(gallery.filter((image) => image.id !== galleryId))
  }

  const images = gallery
    .filter((image) => image.imageUrl)
    .map((image, index) => ({
      src: image.imageUrl as string,
      previewSrc: image.thumbnailUrl ?? undefined,
      alt: `第 ${index + 1} 张截图`
    }))

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl">游戏截图 (可选)</h2>
        <span className="text-sm text-default-500">
          {readyCount} / {PATCH_SUBMISSION_GALLERY_MAX_COUNT}
          {uploading > 0 && ` · 正在上传 ${uploading} 张`}
        </span>
      </div>

      {editable && (
        <div
          {...getRootProps()}
          className={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors',
            isDragActive
              ? 'border-primary bg-primary/10'
              : 'border-default-300 hover:border-primary'
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center justify-center">
            <Upload className="mb-2 size-8 text-default-400" />
            <p className="mb-1">拖放图片到此处或</p>
            <span className="inline-flex items-center px-4 py-2 text-sm font-medium text-primary rounded-medium bg-primary/10">
              选择文件
            </span>
          </div>
        </div>
      )}

      {gallery.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KunImageViewer images={images}>
            {(openLightbox) =>
              gallery.map((image, index) => (
                <SubmissionGalleryCard
                  key={image.id}
                  image={image}
                  index={index}
                  selected={selected.has(image.id)}
                  onToggle={() =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (next.has(image.id)) {
                        next.delete(image.id)
                      } else {
                        next.add(image.id)
                      }
                      return next
                    })
                  }
                  onOpenLightbox={() => openLightbox(index)}
                  onDelete={() => void deleteImage(image.id)}
                />
              ))
            }
          </KunImageViewer>
        </div>
      )}
    </div>
  )
}
