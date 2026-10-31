'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'

import { cn } from '~/lib/dashboard/utils'

/**
 * Console counterpart of the site's sticker thumbnail: shows the poster or
 * static image, and plays a WebM muted and inline only while on screen and
 * when the viewer has not asked for reduced motion.
 */
export function StickerPreview({
  src,
  posterSrc,
  mediaType,
  alt,
  className
}: {
  src: string | null
  posterSrc: string | null
  mediaType: 'image' | 'video'
  alt: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [failed, setFailed] = useState(false)
  const isVideo = mediaType === 'video'
  const image = isVideo ? posterSrc : (src ?? posterSrc)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(Boolean(entry?.isIntersecting))
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const playVideo = isVideo && src && visible && !reducedMotion

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playVideo) void video.play?.()?.catch(() => {})
    else video.pause?.()
  }, [playVideo])

  return (
    <span
      ref={ref}
      role="img"
      aria-label={alt}
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-muted',
        className
      )}
    >
      {playVideo ? (
        <video
          ref={videoRef}
          src={src ?? undefined}
          poster={posterSrc ?? undefined}
          muted
          loop
          playsInline
          aria-hidden="true"
          className="size-full object-contain"
        />
      ) : image && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageOff className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  )
}
