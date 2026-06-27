'use client'

import { useMemo, useRef, useState } from 'react'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { NSFWMask } from '~/components/kun/NSFWMask'
import type { PatchImage } from '~/types/api/patch'
import {
  GalleryOriginalPrefetchQueue,
  getPriorityGallerySlots
} from '~/utils/galleryPrefetch'
import {
  getGalleryOriginalSrc,
  getGalleryPreviewSrc
} from '~/utils/galleryPreview'

interface Props {
  images: PatchImage[]
}

export const Gallery = ({ images }: Props) => {
  const validImages = images?.filter((img) => img.url) ?? []
  const originalUrls = useMemo(
    () => validImages.map((img) => getGalleryOriginalSrc(img)),
    [validImages]
  )
  const prefetchQueue = useRef<GalleryOriginalPrefetchQueue | null>(null)
  if (!prefetchQueue.current) {
    prefetchQueue.current = new GalleryOriginalPrefetchQueue()
  }

  if (validImages.length === 0) return null

  const prioritizeNearbyOriginals = (index: number) => {
    prefetchQueue.current?.prioritize(
      getPriorityGallerySlots(originalUrls, index)
    )
  }

  const handleOpen = (index: number, openLightbox: (index: number) => void) => {
    prioritizeNearbyOriginals(index)
    openLightbox(index)
  }

  return (
    <div className="mt-4 space-y-4">
      <h2 className="text-2xl font-medium">游戏画廊</h2>
      <KunImageViewer
        preload={0}
        onView={prioritizeNearbyOriginals}
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
        src={getGalleryPreviewSrc(image)}
        alt="Game Screenshot"
        className="w-full h-full object-cover transition-transform duration-500 will-change-transform group-hover:scale-110"
        loading="lazy"
      />
      <NSFWMask
        isVisible={!isRevealed}
        onReveal={() => setIsRevealed(true)}
      />
    </div>
  )
}
