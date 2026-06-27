'use client'

import { useEffect, useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'
import type { ReactNode } from 'react'
import { lightboxConfig } from './config'
import {
  createKunImageViewerSlides,
  type KunImageViewerImage,
  type KunImageViewerSlide
} from './slides'

interface Props {
  images: KunImageViewerImage[]
  preload?: number
  children: (openLightbox: (index: number) => void) => ReactNode
}

const ProgressiveImageSlide = ({
  slide
}: {
  slide: KunImageViewerSlide
}) => {
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    setIsLoaded(false)
  }, [slide.src])

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {slide.previewSrc && !isLoaded && (
        <img
          src={slide.previewSrc}
          alt={slide.alt}
          className="absolute max-h-[80%] w-[80%] object-contain opacity-70 blur-sm"
          draggable={false}
        />
      )}
      <img
        src={slide.src}
        alt={slide.alt}
        className={`relative max-h-[80%] w-[80%] object-contain transition-opacity duration-200 ${
          slide.previewSrc && !isLoaded ? 'opacity-0' : 'opacity-100'
        }`}
        draggable={false}
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  )
}

const hasPreviewSrc = (slide: unknown): slide is KunImageViewerSlide =>
  typeof slide === 'object' &&
  slide !== null &&
  'src' in slide &&
  typeof (slide as { src?: unknown }).src === 'string' &&
  'alt' in slide &&
  typeof (slide as { alt?: unknown }).alt === 'string' &&
  'previewSrc' in slide &&
  typeof (slide as { previewSrc?: unknown }).previewSrc === 'string'

export const KunImageViewer = ({
  images,
  preload,
  children
}: Props) => {
  const [index, setIndex] = useState(-1)
  const lightboxImages = createKunImageViewerSlides(images)

  const openLightbox = (index: number) => setIndex(index)
  const closeLightbox = () => setIndex(-1)

  return (
    <>
      {children(openLightbox)}
      <Lightbox
        index={index}
        slides={lightboxImages}
        open={index >= 0}
        close={closeLightbox}
        on={{
          click: closeLightbox
        }}
        render={{
          slide: ({ slide }) => {
            if (hasPreviewSrc(slide)) {
              return <ProgressiveImageSlide slide={slide} />
            }

            return undefined
          }
        }}
        {...lightboxConfig}
        carousel={{
          ...lightboxConfig.carousel,
          preload: preload ?? lightboxConfig.carousel?.preload
        }}
      />
    </>
  )
}
