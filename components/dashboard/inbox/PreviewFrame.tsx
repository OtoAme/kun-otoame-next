'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2 } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '~/components/dashboard/ui/dialog'
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
  const [enlargeOpen, setEnlargeOpen] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Dialog open={enlargeOpen} onOpenChange={setEnlargeOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer text-muted-foreground"
            >
              <Maximize2 className="size-3.5" aria-hidden />
              放大预览
            </Button>
          </DialogTrigger>
          <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col p-4 sm:max-w-[calc(100%-2rem)] sm:p-6">
            <DialogHeader className="pr-6">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                此预览仅供查看，不会执行审核操作。
              </DialogDescription>
            </DialogHeader>
            <iframe
              src={src}
              title={title}
              className="min-h-0 w-full flex-1 rounded-md border bg-background"
            />
          </DialogContent>
        </Dialog>
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
      {/* key isolates each src: the frame DOM and the measured height state
          are rebuilt per document, never carried into another src. */}
      <InlinePreviewFrame
        key={src}
        src={src}
        title={title}
        className={className}
      />
    </div>
  )
}

interface InlinePreviewFrameProps {
  src: string
  title: string
  className?: string
}

// The window cap lives only in CSS: --preview-cap feeds height and
// max-height and matches the old window (max(70dvh,560px), sm:
// max(70dvh,640px)). Until the same-origin document exposes a measurable
// data-admin-preview-content marker the frame keeps that cap; a measured
// short preview shrinks via the inline style height, while taller content
// stays capped by max-height and scrolls inside the frame.
function InlinePreviewFrame({
  src,
  title,
  className
}: InlinePreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }
    let observer: ResizeObserver | null = null
    let currentDoc: Document | null = null
    let rafId: number | null = null
    let disposed = false

    const measure = () => {
      rafId = null
      if (disposed) {
        return
      }
      let doc: Document | null = null
      try {
        doc = iframe.contentDocument
      } catch {
        doc = null
      }
      // Only write for the document this observer cycle attached to.
      if (!doc || doc !== currentDoc) {
        return
      }
      const marker = doc.querySelector('[data-admin-preview-content]')
      if (!marker || !marker.isConnected) {
        return
      }
      const height = marker.getBoundingClientRect().height
      if (height <= 0) {
        return
      }
      const styles = window.getComputedStyle(iframe)
      const borders =
        (parseFloat(styles.borderTopWidth) || 0) +
        (parseFloat(styles.borderBottomWidth) || 0)
      setContentHeight(height + borders)
    }

    const scheduleMeasure = () => {
      if (disposed) {
        return
      }
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      rafId = window.requestAnimationFrame(measure)
    }

    // Every load (including same-src reloads): cancel any pending frame
    // measurement, drop the old observer, and reset to the cap window
    // before re-checking the fresh document. Without a connected marker
    // the frame stays at the cap.
    const attach = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }
      observer?.disconnect()
      observer = null
      setContentHeight(null)
      try {
        currentDoc = iframe.contentDocument
      } catch {
        currentDoc = null
      }
      const marker =
        currentDoc?.querySelector('[data-admin-preview-content]') ?? null
      if (!currentDoc || !marker || !marker.isConnected) {
        return
      }
      measure()
      const FrameResizeObserver = currentDoc.defaultView?.ResizeObserver
      if (!FrameResizeObserver) {
        return
      }
      observer = new FrameResizeObserver(scheduleMeasure)
      observer.observe(marker)
    }

    iframe.addEventListener('load', attach)
    attach()
    return () => {
      disposed = true
      iframe.removeEventListener('load', attach)
      observer?.disconnect()
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      currentDoc = null
    }
  }, [src])

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      style={contentHeight != null ? { height: contentHeight } : undefined}
      className={cn(
        'w-full rounded-md border bg-background',
        '[--preview-cap:max(70dvh,560px)] h-(--preview-cap) max-h-(--preview-cap) sm:[--preview-cap:max(70dvh,640px)]',
        className
      )}
    />
  )
}
