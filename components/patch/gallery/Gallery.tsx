'use client'

import { useState } from 'react'
import { EyeOff } from 'lucide-react'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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

  return (
    <div
      className="group relative z-0 aspect-video cursor-pointer overflow-hidden rounded-lg bg-default-100"
      onClick={() => {
        if (isRevealed) {
          onOpen()
        } else {
          setIsRevealed(true)
        }
      }}
    >
      <img
        src={image.url}
        alt="Game Screenshot"
        className="w-full h-full object-cover transition-transform duration-500 will-change-transform group-hover:scale-110"
        loading="lazy"
      />
      {!isRevealed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md transition-colors duration-200 group-hover:bg-black/40 rounded-lg">
          <EyeOff className="mb-2 size-8 text-white transition-transform duration-200 group-hover:scale-110" />
          <span className="text-sm font-medium text-white">NSFW 内容</span>
          <span className="text-xs text-white/80">点击查看</span>
        </div>
      )}
    </div>
  )
}
