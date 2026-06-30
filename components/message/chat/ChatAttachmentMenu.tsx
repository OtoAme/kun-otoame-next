'use client'

import { ImageIcon } from 'lucide-react'

interface Props {
  isOpen: boolean
  onPickImage: () => void
}

export const ChatAttachmentMenu = ({ isOpen, onPickImage }: Props) => {
  if (!isOpen) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 rounded-xl border border-default-200 bg-content1 p-2 text-sm shadow-xl">
      <button
        type="button"
        aria-label="选择图片"
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 transition-colors hover:bg-default-100 focus:bg-default-100"
        onClick={onPickImage}
      >
        <ImageIcon className="size-4" />
        图片
      </button>
    </div>
  )
}
