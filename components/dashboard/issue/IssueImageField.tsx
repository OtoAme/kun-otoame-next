'use client'

import { useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { cn } from '~/lib/dashboard/utils'
import {
  CASE_IMAGE_ALLOWED_TYPES,
  CASE_IMAGE_MAX_PER_MESSAGE
} from '~/constants/case'
import type { useCaseImageUploads } from '~/components/case/useCaseImageUploads'

interface IssueImageFieldProps {
  uploads: ReturnType<typeof useCaseImageUploads>
  disabled?: boolean
}

const ALLOWED = new Set<string>(CASE_IMAGE_ALLOWED_TYPES)

/** Image files among dropped or pasted items; other kinds are ignored. */
const imageFiles = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter((file) => ALLOWED.has(file.type))

/**
 * Paste handler for the text box beside the field: a pasted image (e.g. a
 * screenshot) is uploaded, while a text paste keeps its normal behavior.
 */
export const imagePasteHandler =
  (uploads: ReturnType<typeof useCaseImageUploads>, disabled?: boolean) =>
  (event: ClipboardEvent<HTMLElement>) => {
    const files = imageFiles(event.clipboardData?.files)
    if (files.length === 0) return
    event.preventDefault()
    if (disabled || uploads.uploading || uploads.full) return
    void uploads.add(files)
  }

/**
 * shadcn counterpart of the site entries' image field (D11). Images can be
 * picked from files, dropped on the field, or pasted while it has focus;
 * all three go through the same upload hook and its limits.
 */
export function IssueImageField({ uploads, disabled }: IssueImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const blocked = disabled || uploads.uploading || uploads.full

  const take = (files: File[]) => {
    if (blocked || files.length === 0) return
    void uploads.add(files)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    take(imageFiles(event.dataTransfer?.files))
  }

  const onPaste = imagePasteHandler(uploads, disabled)

  return (
    <div className="w-full space-y-2">
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
          take(imageFiles(event.target.files))
          event.target.value = ''
        }}
      />
      <div
        role="button"
        tabIndex={blocked ? -1 : 0}
        aria-disabled={blocked || undefined}
        aria-label={`添加图片，最多 ${CASE_IMAGE_MAX_PER_MESSAGE} 张：点击选择文件，也可拖入或粘贴`}
        data-image-drop
        onClick={() => {
          if (!blocked) inputRef.current?.click()
        }}
        onKeyDown={(event) => {
          if (blocked) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!blocked) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          blocked
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
          dragging && 'border-primary bg-accent text-accent-foreground'
        )}
      >
        {uploads.uploading ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <ImagePlus className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0">
          {uploads.full
            ? `已添加 ${CASE_IMAGE_MAX_PER_MESSAGE} 张图片`
            : uploads.uploading
              ? '正在上传…'
              : `点击选择、拖入或粘贴图片（最多 ${CASE_IMAGE_MAX_PER_MESSAGE} 张）`}
        </span>
      </div>
      {uploads.error ? (
        <p role="alert" className="text-sm text-destructive">
          {uploads.error}
        </p>
      ) : null}
    </div>
  )
}
