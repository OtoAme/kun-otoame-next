'use client'

import { Image } from '@heroui/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '~/utils/cn'

interface Props {
  src: string | null
  posterSrc?: string | null
  mediaType: 'image' | 'video'
  mime?: string
  alt?: string
  className?: string
  fallback?: ReactNode
}

export const StickerThumbnail = ({
  src,
  posterSrc = null,
  mediaType,
  mime,
  alt,
  className,
  fallback = null
}: Props) => {
  const containerRef = useRef<HTMLSpanElement>(null)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false)
  const [isReducedMotion, setIsReducedMotion] = useState(false)
  const [isVideoReady, setIsVideoReady] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [imageError, setImageError] = useState(false)
  const isVideo = mediaType === 'video' || mime === 'video/webm'
  const imageSrc = isVideo ? posterSrc : (src ?? posterSrc)

  useEffect(() => {
    setIsVideoReady(false)
    setVideoError(false)
    setImageError(false)
  }, [posterSrc, src])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotionPreference = () => setIsReducedMotion(mediaQuery.matches)
    syncMotionPreference()
    mediaQuery.addEventListener('change', syncMotionPreference)

    return () => mediaQuery.removeEventListener('change', syncMotionPreference)
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      setHasEnteredViewport(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry], currentObserver) => {
        if (entry?.isIntersecting) {
          setHasEnteredViewport(true)
          currentObserver.disconnect()
        }
      },
      { rootMargin: '160px' }
    )
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const showVideo = Boolean(
    isVideo && src && hasEnteredViewport && !isReducedMotion && !videoError
  )
  const showImage = Boolean(
    imageSrc && !imageError && (!showVideo || !isVideoReady)
  )
  const showFallback = !showImage && !showVideo

  useEffect(() => {
    if (!showVideo) {
      setIsVideoReady(false)
    }
  }, [showVideo])

  return (
    <span
      ref={containerRef}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      className={cn('relative block overflow-hidden', className)}
    >
      {showImage && (
        <Image
          removeWrapper
          src={imageSrc!}
          alt=""
          aria-hidden="true"
          loading="lazy"
          data-testid="sticker-thumbnail-poster"
          className="absolute inset-0 size-full object-contain"
          onError={() => setImageError(true)}
        />
      )}

      {showVideo && (
        <video
          src={src!}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          data-testid="sticker-thumbnail-video"
          className={cn(
            'absolute inset-0 size-full bg-transparent object-contain transition-opacity',
            isVideoReady ? 'opacity-100' : 'opacity-0'
          )}
          onLoadedData={() => setIsVideoReady(true)}
          onPlaying={() => setIsVideoReady(true)}
          onError={() => setVideoError(true)}
        />
      )}

      {showFallback && fallback}
    </span>
  )
}
