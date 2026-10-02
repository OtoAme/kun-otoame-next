'use client'

import { useEffect, useRef, useState } from 'react'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { NSFWMask } from '~/components/kun/NSFWMask'
import type { PatchImage } from '~/types/api/patch'
import {
  getGalleryOriginalSrc,
  getGalleryPreviewSrc
} from '~/utils/galleryPreview'

interface Props {
  images: PatchImage[]
  /** Forwarded so a modal host can stop dismissing while the lightbox is open. */
  onLightboxOpenChange?: (open: boolean) => void
}

export const Gallery = ({ images, onLightboxOpenChange }: Props) => {
  const validImages = images?.filter((img) => img.url) ?? []

  if (validImages.length === 0) return null

  const handleOpen = (index: number, openLightbox: (index: number) => void) => {
    openLightbox(index)
  }

  return (
    <div className="mt-4 space-y-4">
      <h2 className="text-2xl font-medium">游戏画廊</h2>
      <KunImageViewer
        preload={2}
        onOpenChange={onLightboxOpenChange}
        images={validImages.map((img) => ({
          src: getGalleryOriginalSrc(img),
          previewSrc: getGalleryPreviewSrc(img),
          alt: 'Game Screenshot'
        }))}
      >
        {(openLightbox) => (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
            {validImages.map((img, index) => (
              <GalleryItem
                key={img.id}
                image={img}
                onOpen={() => handleOpen(index, openLightbox)}
              />
            ))}
          </div>
        )}
      </KunImageViewer>
    </div>
  )
}

const GalleryItem = ({
  image,
  onOpen
}: {
  image: PatchImage
  onOpen: () => void
}) => {
  const [isRevealed, setIsRevealed] = useState(!image.isNSFW)
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false)
  const preloadedOriginalRef = useRef<string | null>(null)
  const previewSrc = getGalleryPreviewSrc(image)
  const originalSrc = getGalleryOriginalSrc(image)

  useEffect(() => {
    if (
      !isPreviewLoaded ||
      previewSrc === originalSrc ||
      preloadedOriginalRef.current === originalSrc
    ) {
      return
    }

    const originalImage = new window.Image()
    originalImage.decoding = 'async'
    originalImage.fetchPriority = 'low'
    originalImage.src = originalSrc
    preloadedOriginalRef.current = originalSrc
  }, [isPreviewLoaded, originalSrc, previewSrc])

  const handleClick = () => {
    if (isRevealed) {
      onOpen()
    }
  }

  return (
    <div
      className="group relative z-0 aspect-video cursor-pointer overflow-hidden rounded-lg bg-default-100"
      onClick={handleClick}
    >
      <img
        src={previewSrc}
        alt="Game Screenshot"
        className="w-full h-full object-cover transition-transform duration-500 will-change-transform group-hover:scale-110"
        loading="lazy"
        onLoad={() => setIsPreviewLoaded(true)}
      />
      <NSFWMask isVisible={!isRevealed} onReveal={() => setIsRevealed(true)} />
    </div>
  )
}
