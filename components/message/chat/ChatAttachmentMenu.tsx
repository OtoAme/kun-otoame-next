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
    <div
      role="menu"
      aria-label="附件"
      className="absolute bottom-full left-0 z-50 mb-2 rounded-xl border border-[var(--kun-chat-menu-border)] bg-[var(--kun-chat-menu-bg)] p-2 text-sm text-[var(--kun-chat-menu-text)] shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        aria-label="选择图片"
        className="flex min-h-11 min-w-28 items-center gap-2 whitespace-nowrap rounded-lg px-3 transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:bg-[var(--kun-chat-menu-item-hover-bg)]"
        onClick={onPickImage}
      >
        <ImageIcon className="size-4" />
        图片
      </button>
    </div>
  )
}
