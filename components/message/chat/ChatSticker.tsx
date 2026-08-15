'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '~/utils/cn'
import type { PrivateMessageSticker } from '~/types/api/conversation'

interface Props {
  sticker: PrivateMessageSticker
  className?: string
}

export const ChatSticker = ({ sticker, className }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isReducedMotion, setIsReducedMotion] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [posterError, setPosterError] = useState(false)
  const [readyVideoUrl, setReadyVideoUrl] = useState<string | null>(null)
  const isVideo = sticker.mediaType === 'video' || sticker.mime === 'video/webm'

  useEffect(() => {
    setMediaError(false)
    setPosterError(false)
    setReadyVideoUrl(null)
  }, [sticker.id, sticker.url])

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
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '240px' }
    )
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (!isVisible || isReducedMotion || mediaError) {
      video.pause()
      return
    }

    if (typeof video.play !== 'function') {
      return
    }

    try {
      const playResult = video.play()
      if (playResult && typeof playResult.catch === 'function') {
        void playResult.catch(() => {
          // Browsers may still reject autoplay. The poster remains visible.
        })
      }
    } catch {
      // jsdom and some older browsers do not implement media playback.
    }
  }, [isReducedMotion, isVisible, mediaError])

  const showVideo = isVideo && isVisible && !isReducedMotion && !mediaError
  const poster = posterError ? null : sticker.thumbnailUrl
  const isVideoFrameReady = showVideo && readyVideoUrl === sticker.url

  useEffect(() => {
    if (!showVideo) {
      setReadyVideoUrl(null)
    }
  }, [showVideo])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={sticker.alt || sticker.packName}
      data-testid="chat-sticker"
      className={cn(
        'relative w-[min(70cqw,16rem)] max-w-full overflow-hidden rounded-2xl',
        className
      )}
      style={{
        aspectRatio:
          sticker.width > 0 && sticker.height > 0
            ? `${sticker.width} / ${sticker.height}`
            : '1'
      }}
    >
      {isVideo ? (
        poster && !isVideoFrameReady ? (
          <img
            data-testid="chat-sticker-poster"
            src={poster}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setPosterError(true)}
          />
        ) : null
      ) : (
        <img
          src={sticker.url}
          alt={sticker.alt || sticker.packName}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => setMediaError(true)}
        />
      )}

      {showVideo && (
        <video
          ref={videoRef}
          src={sticker.url}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-label={sticker.alt || sticker.packName}
          className={cn(
            'absolute inset-0 h-full w-full bg-transparent object-contain',
            isVideoFrameReady ? 'opacity-100' : 'opacity-0'
          )}
          onLoadedData={() => setReadyVideoUrl(sticker.url)}
          onPlaying={() => setReadyVideoUrl(sticker.url)}
          onError={() => setMediaError(true)}
        />
      )}

      {mediaError && !poster && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--kun-chat-image-tile-bg)] px-3 text-center text-xs text-[var(--kun-chat-muted-text)]">
          贴纸不可用
        </div>
      )}

      {isVideo && !poster && !isVideoFrameReady && !mediaError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--kun-chat-image-tile-bg)] text-xs text-[var(--kun-chat-muted-text)]">
          {isReducedMotion ? '贴纸不可用' : '加载贴纸中'}
        </div>
      )}
    </div>
  )
}
