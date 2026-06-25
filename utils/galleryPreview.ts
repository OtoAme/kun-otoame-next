export interface GalleryImagePreviewSource {
  url: string
  thumbnailUrl?: string | null
  thumbnail_url?: string | null
}

export const getGalleryPreviewSrc = (image: GalleryImagePreviewSource) =>
  image.thumbnailUrl || image.thumbnail_url || image.url

export const getGalleryOriginalSrc = (image: GalleryImagePreviewSource) =>
  image.url
