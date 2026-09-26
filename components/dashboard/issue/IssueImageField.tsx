'use client'

import { useRef } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  CASE_IMAGE_ALLOWED_TYPES,
  CASE_IMAGE_MAX_PER_MESSAGE
} from '~/constants/case'
import type { useCaseImageUploads } from '~/components/case/useCaseImageUploads'

interface IssueImageFieldProps {
  uploads: ReturnType<typeof useCaseImageUploads>
  disabled?: boolean
}

/** shadcn counterpart of the site entries' image field (D11). */
export function IssueImageField({ uploads, disabled }: IssueImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      {uploads.images.length ? (
        <ul className="flex flex-wrap gap-3" aria-label="已添加的图片">
          {uploads.images.map((image, index) => (
            <li key={image.key} className="relative">
              <img
                src={image.url}
                alt={`附图 ${index + 1}`}
                className="size-16 rounded-md border object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={`移除附图 ${index + 1}`}
                className="absolute -top-2 -right-2 rounded-full"
                disabled={disabled}
                onClick={() => uploads.remove(image.key)}
              >
                <X className="size-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
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
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploads.uploading || uploads.full}
        onClick={() => inputRef.current?.click()}
      >
        {uploads.uploading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ImagePlus className="size-4" aria-hidden />
        )}
        {uploads.full
          ? `已添加 ${CASE_IMAGE_MAX_PER_MESSAGE} 张图片`
          : `添加图片（最多 ${CASE_IMAGE_MAX_PER_MESSAGE} 张）`}
      </Button>
      {uploads.error ? (
        <p role="alert" className="text-sm text-destructive">
          {uploads.error}
        </p>
      ) : null}
    </div>
  )
}
