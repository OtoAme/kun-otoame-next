'use client'

import { useState } from 'react'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { NSFWMask } from '~/components/kun/NSFWMask'
import type { PatchImage } from '~/types/api/patch'

interface Props {
  images: PatchImage[]
}

export const Gallery = ({ images }: Props) => {
  if (!images || images.length === 0) return null

  return (
    <div className="mt-4 space-y-4">
      <h2 className="text-xl font-bold">游戏画廊</h2>
      <KunImageViewer
        images={images.map((img) => ({ src: img.url, alt: 'Game Screenshot' }))}
      >
        {(openLightbox) => (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
            {images.map((img, index) => (
              <GalleryItem
                key={img.id}
                image={img}
                onOpen={() => openLightbox(index)}
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
        src={image.url}
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
