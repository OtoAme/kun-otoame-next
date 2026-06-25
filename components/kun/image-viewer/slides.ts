export interface KunImageViewerImage {
  src: string
  previewSrc?: string
  alt: string
  width?: number
  height?: number
}

export interface KunImageViewerSlide extends KunImageViewerImage {
  previewSrc?: string
}

export const createKunImageViewerSlides = (
  images: KunImageViewerImage[]
): KunImageViewerSlide[] =>
  images.map(({ src, previewSrc, alt, width, height }) => {
    const slide: KunImageViewerSlide = { src, alt }

    if (width !== undefined) {
      slide.width = width
    }

    if (height !== undefined) {
      slide.height = height
    }

    if (previewSrc && previewSrc !== src) {
      slide.previewSrc = previewSrc
    }

    return slide
  })
