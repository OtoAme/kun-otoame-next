import { describe, expect, it } from 'vitest'
import {
  getGalleryOriginalSrc,
  getGalleryPreviewSrc
} from '~/utils/galleryPreview'

describe('gallery preview helpers', () => {
  it('uses thumbnailUrl for persisted image previews and keeps url for originals', () => {
    const image = {
      url: 'https://img.example/patch/1/gallery/2.webp',
      thumbnailUrl: 'https://img.example/patch/1/gallery/thumbnail/2.webp'
    }

    expect(getGalleryPreviewSrc(image)).toBe(
      'https://img.example/patch/1/gallery/thumbnail/2.webp'
    )
    expect(getGalleryOriginalSrc(image)).toBe(
      'https://img.example/patch/1/gallery/2.webp'
    )
  })

  it('falls back to original url when thumbnailUrl is unavailable', () => {
    const image = {
      url: 'https://img.example/patch/1/gallery/2.avif',
      thumbnailUrl: null
    }

    expect(getGalleryPreviewSrc(image)).toBe(
      'https://img.example/patch/1/gallery/2.avif'
    )
    expect(getGalleryOriginalSrc(image)).toBe(
      'https://img.example/patch/1/gallery/2.avif'
    )
  })

  it('supports rewrite-store thumbnail_url without changing the original url', () => {
    const image = {
      url: 'https://img.example/patch/1/gallery/3.webp',
      thumbnail_url: 'https://img.example/patch/1/gallery/thumbnail/3.webp'
    }

    expect(getGalleryPreviewSrc(image)).toBe(
      'https://img.example/patch/1/gallery/thumbnail/3.webp'
    )
    expect(getGalleryOriginalSrc(image)).toBe(
      'https://img.example/patch/1/gallery/3.webp'
    )
  })
})
