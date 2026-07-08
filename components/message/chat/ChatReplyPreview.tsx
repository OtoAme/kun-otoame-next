'use client'

import { cn } from '~/utils/cn'
import type { PrivateMessageImage } from '~/types/api/conversation'

interface Props {
  senderName: string
  actionLabel?: string
  content?: string | null
  selectedText?: string | null
  image?: PrivateMessageImage | null
  onClick?: () => void
  className?: string
  titleClassName?: string
  contentClassName?: string
}

export const ChatReplyPreview = ({
  senderName,
  actionLabel,
  content,
  selectedText,
  image,
  onClick,
  className,
  titleClassName,
  contentClassName
}: Props) => {
  const previewContent = (
    <>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'truncate font-semibold leading-[1.25rem]',
            titleClassName
          )}
        >
          {actionLabel ? `${actionLabel} ${senderName}` : senderName}
        </div>
        <div
          className={cn(
            'truncate leading-[1.25rem] opacity-90',
            contentClassName
          )}
        >
          {selectedText || content || '[图片]'}
        </div>
      </div>
      {image && (
        <img
          src={image.url}
          alt={image.name || '引用图片'}
          loading="lazy"
          className="size-9 shrink-0 rounded-md object-cover"
        />
      )}
    </>
  )
  const previewClassName = cn(
    "relative flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-md py-1.5 pl-3.5 pr-2.5 text-left text-[13px] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1 before:rounded-full before:bg-[hsl(var(--kun-brand-500)/0.86)] before:content-['']",
    onClick &&
      'w-full cursor-pointer outline-none transition-colors hover:bg-[hsl(var(--kun-brand-50)/0.55)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500))] dark:hover:bg-[hsl(var(--kun-brand-500)/0.1)]',
    className
  )

  if (onClick) {
    return (
      <button
        type="button"
        data-testid="chat-reply-preview"
        className={previewClassName}
        onClick={onClick}
      >
        {previewContent}
      </button>
    )
  }

  return (
    <div data-testid="chat-reply-preview" className={previewClassName}>
      {previewContent}
    </div>
  )
}
