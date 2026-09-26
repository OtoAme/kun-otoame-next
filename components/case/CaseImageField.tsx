'use client'

import { useRef } from 'react'
import { Button } from '@heroui/react'
import { ImagePlus, X } from 'lucide-react'
import {
  CASE_IMAGE_ALLOWED_TYPES,
  CASE_IMAGE_MAX_PER_MESSAGE
} from '~/constants/case'
import type { useCaseImageUploads } from './useCaseImageUploads'

interface Props {
  uploads: ReturnType<typeof useCaseImageUploads>
  isDisabled?: boolean
}

/** Up to three private reporter images for one case note (D11). */
export const CaseImageField = ({ uploads, isDisabled }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      {uploads.images.length ? (
        <div className="flex flex-wrap gap-3">
          {uploads.images.map((image, index) => (
            <div key={image.key} className="relative">
              <img
                src={image.url}
                alt={`附图 ${index + 1}`}
                className="size-16 rounded-medium object-cover"
              />
              <Button
                isIconOnly
                size="sm"
                radius="full"
                aria-label={`移除附图 ${index + 1}`}
                className="absolute -right-2 -top-2 h-6 w-6 min-w-6"
                isDisabled={isDisabled}
                onPress={() => uploads.remove(image.key)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={CASE_IMAGE_ALLOWED_TYPES.join(',')}
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void uploads.add(event.target.files)
          event.target.value = ''
        }}
      />
      <Button
        size="sm"
        variant="flat"
        startContent={<ImagePlus className="size-4" />}
        isLoading={uploads.uploading}
        isDisabled={isDisabled || uploads.full}
        onPress={() => inputRef.current?.click()}
      >
        {uploads.full
          ? `已添加 ${CASE_IMAGE_MAX_PER_MESSAGE} 张图片`
          : `添加图片（最多 ${CASE_IMAGE_MAX_PER_MESSAGE} 张）`}
      </Button>
      {uploads.error ? (
        <p role="alert" className="text-sm text-danger">
          {uploads.error}
        </p>
      ) : null}
    </div>
  )
}
