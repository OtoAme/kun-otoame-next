'use client'

import { cn } from '~/utils/cn'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import type { PrivateMessageImage } from '~/types/api/conversation'

interface Props {
  images: PrivateMessageImage[]
  caption?: string
  singleImageVariant?: 'fit' | 'framed'
  className?: string
  imageClassName?: string
  activeImageIndex?: number | null
  isActiveImageFading?: boolean
  onImageContextMenu?: (
    index: number,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => void
  onImagePointerDown?: (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void
  onImagePointerMove?: (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void
  onImagePointerUp?: (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void
  onImagePointerCancel?: (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void
  onImageOpen?: (index: number) => void
}

const getGridClassName = (count: number) => {
  if (count <= 1) {
    return 'grid-cols-1'
  }
  if (count === 2) {
    return 'grid-cols-2'
  }
  return 'grid-cols-2'
}

const getImageAspectClassName = (count: number, image: PrivateMessageImage) => {
  if (count === 1) {
    return 'max-h-[28rem]'
  }

  if (count === 2) {
    return 'aspect-square'
  }

  return count % 2 === 1 && count > 4 ? 'aspect-[4/3]' : 'aspect-square'
}

const getSingleImageAspectRatio = (image: PrivateMessageImage) =>
  image.width > 0 && image.height > 0
    ? `${image.width} / ${image.height}`
    : undefined

const getSingleImageWidth = (image: PrivateMessageImage) => {
  if (image.width <= 0 || image.height <= 0) {
    return undefined
  }

  const ratio = image.width / image.height
  const naturalWidthRem = image.width / 16
  const maxVisualHeightRem = ratio < 0.55 ? 32 : ratio < 0.9 ? 36 : 42
  const minWidthRem = ratio < 0.55 ? 10 : 12
  const maxHeightWidthRem = maxVisualHeightRem * ratio
  const widthRem = Math.max(
    minWidthRem,
    Math.min(naturalWidthRem, maxHeightWidthRem, 42)
  )

  return `${widthRem.toFixed(3)}rem`
}

const getSingleImageStyle = (
  image: PrivateMessageImage,
  isFramed: boolean
): CSSProperties | undefined => {
  if (isFramed) {
    return undefined
  }

  return {
    aspectRatio: getSingleImageAspectRatio(image),
    width: getSingleImageWidth(image)
  }
}

const stopTouchPreviewPropagation = (
  event: ReactPointerEvent<HTMLButtonElement>
) => {
  if (event.pointerType !== 'mouse') {
    event.stopPropagation()
  }
}

export const ChatImageGrid = ({
  images,
  caption,
  singleImageVariant = 'fit',
  className,
  imageClassName,
  activeImageIndex,
  isActiveImageFading,
  onImageContextMenu,
  onImagePointerDown,
  onImagePointerMove,
  onImagePointerUp,
  onImagePointerCancel,
  onImageOpen
}: Props) => {
  if (images.length === 0) {
    return null
  }

  const viewerImages = images.map((image) => ({
    src: image.url,
    alt: image.name || caption || '聊天图片',
    width: image.width,
    height: image.height
  }))
  const isSingleImage = images.length === 1
  const isFramedSingleImage = isSingleImage && singleImageVariant === 'framed'

  const renderGrid = (openLightbox: (index: number) => void) => (
    <div
      className={cn(
        'grid overflow-hidden rounded-[1.05rem]',
        getGridClassName(images.length),
        images.length > 1 && 'gap-1',
        isSingleImage && !isFramedSingleImage && 'w-fit max-w-full',
        isFramedSingleImage && 'bg-[var(--kun-chat-image-frame-bg)]',
        className
      )}
    >
      {images.map((image, index) => (
        <button
          key={`${image.url}-${index}`}
          type="button"
          className={cn(
            'group relative block min-h-0 min-w-0 overflow-hidden bg-[var(--kun-chat-image-tile-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500))]',
            getImageAspectClassName(images.length, image),
            isSingleImage && 'max-h-[min(80vh,60rem)] max-w-full',
            isFramedSingleImage && 'aspect-[4/3] h-full w-full bg-transparent',
            imageClassName
          )}
          style={
            isSingleImage
              ? getSingleImageStyle(image, isFramedSingleImage)
              : undefined
          }
          aria-label={`查看图片 ${index + 1}`}
          onPointerDown={(event) => {
            onImagePointerDown?.(index, event)
            stopTouchPreviewPropagation(event)
          }}
          onPointerMove={(event) => {
            onImagePointerMove?.(index, event)
            stopTouchPreviewPropagation(event)
          }}
          onPointerUp={(event) => {
            onImagePointerUp?.(index, event)
            stopTouchPreviewPropagation(event)
          }}
          onPointerCancel={(event) => {
            onImagePointerCancel?.(index, event)
            stopTouchPreviewPropagation(event)
          }}
          onContextMenu={(event) => onImageContextMenu?.(index, event)}
          onClick={(event) => {
            event.stopPropagation()
            openLightbox(index)
          }}
        >
          {isFramedSingleImage && (
            <img
              src={image.url}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-xl"
            />
          )}
          <img
            src={image.url}
            alt={image.name || caption || '聊天图片'}
            loading="lazy"
            className={cn(
              'relative z-10 h-full w-full transition-transform duration-200 group-hover:scale-[1.015]',
              images.length === 1 ? 'object-contain' : 'object-cover'
            )}
          />
          {activeImageIndex === index && (
            <span
              data-testid="chat-image-context-overlay"
              className={cn(
                'pointer-events-none absolute inset-0 z-20 bg-[var(--kun-chat-highlight-bg)] transition-opacity duration-300',
                isActiveImageFading ? 'opacity-0' : 'opacity-100'
              )}
            />
          )}
        </button>
      ))}
    </div>
  )

  if (onImageOpen) {
    return renderGrid(onImageOpen)
  }

  return (
    <KunImageViewer images={viewerImages} preload={2}>
      {(openLightbox) => renderGrid(openLightbox)}
    </KunImageViewer>
  )
}
