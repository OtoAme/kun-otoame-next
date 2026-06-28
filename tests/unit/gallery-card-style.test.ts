import { describe, expect, it } from 'vitest'

import { getGalleryUploadFailedOverlayClass } from '~/utils/galleryCardStyle'

describe('gallery card style rules', () => {
  it('uses a red translucent non-interactive overlay for failed uploads', () => {
    const className = getGalleryUploadFailedOverlayClass()

    expect(className).toContain('bg-danger/20')
    expect(className).toContain('pointer-events-none')
    expect(className).toContain('absolute')
    expect(className).toContain('inset-0')
  })
})
