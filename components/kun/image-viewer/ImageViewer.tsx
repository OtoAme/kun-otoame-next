'use client'

import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'
import { useState } from 'react'
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

interface ControlledProps {
  images: KunImageViewerImage[]
  index: number
  preload?: number
  onClose: () => void
  onView?: (index: number) => void
}

const ProgressiveImageSlide = ({
  slide,
  children
}: {
  slide: KunImageViewerSlide
  children: ReactNode
}) => (
  <div className="relative flex h-full w-full items-center justify-center">
    <img
      src={slide.previewSrc}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute max-h-[80%] w-[80%] object-contain opacity-70 blur-sm"
      draggable={false}
    />
    <div className="relative h-full w-full">{children}</div>
  </div>
)

const LightboxSlideInteractionGuard = ({
  children
}: {
  children: ReactNode
}) => (
  <div
    data-testid="lightbox-slide-guard"
    className="h-full w-full"
    onContextMenu={(event) => {
      event.stopPropagation()
    }}
  >
    {children}
  </div>
)

const hasPreviewSrc = (slide: unknown): slide is KunImageViewerSlide =>
  typeof slide === 'object' &&
  slide !== null &&
  'src' in slide &&
  typeof (slide as { src?: unknown }).src === 'string' &&
  'alt' in slide &&
  typeof (slide as { alt?: unknown }).alt === 'string' &&
  'previewSrc' in slide &&
  typeof (slide as { previewSrc?: unknown }).previewSrc === 'string'

export const KunImageViewer = ({ images, preload, children }: Props) => {
  const [index, setIndex] = useState(-1)

  const openLightbox = (index: number) => setIndex(index)
  const closeLightbox = () => setIndex(-1)

  return (
    <>
      {children(openLightbox)}
      <KunControlledImageViewer
        images={images}
        index={index}
        preload={preload}
        onClose={closeLightbox}
        onView={setIndex}
      />
    </>
  )
}

export const KunControlledImageViewer = ({
  images,
  index,
  preload,
  onClose,
  onView
}: ControlledProps) => {
  const lightboxImages = createKunImageViewerSlides(images)

  return (
    <Lightbox
      index={index}
      slides={lightboxImages}
      open={index >= 0}
      close={onClose}
      on={{
        click: onClose,
        view: ({ index: currentIndex }) => onView?.(currentIndex)
      }}
      render={{
        slideContainer: ({ slide, children }) => {
          if (hasPreviewSrc(slide)) {
            return (
              <LightboxSlideInteractionGuard>
                <ProgressiveImageSlide slide={slide}>
                  {children}
                </ProgressiveImageSlide>
              </LightboxSlideInteractionGuard>
            )
          }

          return (
            <LightboxSlideInteractionGuard>
              {children}
            </LightboxSlideInteractionGuard>
          )
        }
      }}
      {...lightboxConfig}
      carousel={{
        ...lightboxConfig.carousel,
        preload: preload ?? lightboxConfig.carousel?.preload
      }}
    />
  )
}
