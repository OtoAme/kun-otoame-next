'use client'

import { ExternalLink } from 'lucide-react'

import { cn } from '~/lib/dashboard/utils'

interface PreviewFrameProps {
  src: string
  title: string
  className?: string
}

/**
 * Same-origin readonly admin preview frame. Never points at download/restore
 * endpoints; the preview route itself is admin-only and readonly.
 */
export function PreviewFrame({ src, title, className }: PreviewFrameProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          新标签页打开{title}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <iframe
        src={src}
        title={title}
        className={cn(
          'h-[520px] w-full rounded-md border bg-background',
          className
        )}
      />
    </div>
  )
}
