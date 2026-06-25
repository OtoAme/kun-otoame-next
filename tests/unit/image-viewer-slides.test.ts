import { describe, expect, it } from 'vitest'
import { createKunImageViewerSlides } from '~/components/kun/image-viewer/slides'

describe('KunImageViewer slides', () => {
  it('keeps original src as the lightbox image and carries previewSrc for progressive rendering', () => {
    const slides = createKunImageViewerSlides([
      {
        src: 'https://img.example/patch/1/gallery/2.avif',
        previewSrc:
          'https://img.example/patch/1/gallery/thumbnail/2.avif',
        alt: 'gallery',
        width: 1920,
        height: 1080
      }
    ])

    expect(slides).toEqual([
      {
        src: 'https://img.example/patch/1/gallery/2.avif',
        previewSrc:
          'https://img.example/patch/1/gallery/thumbnail/2.avif',
        alt: 'gallery',
        width: 1920,
        height: 1080
      }
    ])
  })

  it('omits previewSrc when it is the same as the original src', () => {
    const slides = createKunImageViewerSlides([
      {
        src: 'blob:http://localhost/local-preview',
        previewSrc: 'blob:http://localhost/local-preview',
        alt: 'local gallery'
      }
    ])

    expect(slides).toEqual([
      {
        src: 'blob:http://localhost/local-preview',
        alt: 'local gallery'
      }
    ])
  })
})
