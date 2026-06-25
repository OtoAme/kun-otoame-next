import { beforeEach, describe, expect, it, vi } from 'vitest'

const sharpMock = vi.hoisted(() => vi.fn())
const uploadImageToS3Mock = vi.hoisted(() => vi.fn())

vi.mock('sharp', () => ({
  default: sharpMock
}))

vi.mock('~/lib/s3', () => ({
  uploadImageToS3: uploadImageToS3Mock
}))

import {
  GALLERY_ANIMATED_MAX_SIZE_MB,
  getGalleryUploadPlan,
  preparePatchGalleryImage,
  uploadPatchGalleryImage
} from '~/app/api/edit/galleryUpload'

const createSharpPipeline = (metadata: Record<string, unknown>) => {
  const pipeline = {
    metadata: vi.fn().mockResolvedValue(metadata),
    resize: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    avif: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed-image'))
  }

  sharpMock.mockReturnValue(pipeline)
  return pipeline
}

const toExactArrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer

const createAnimatedAvifHeader = () => {
  const buffer = Buffer.alloc(24)
  buffer.writeUInt32BE(24, 0)
  buffer.write('ftyp', 4, 'ascii')
  buffer.write('avis', 8, 'ascii')
  buffer.write('mif1', 16, 'ascii')
  return buffer
}

describe('gallery upload plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores animated WebP originals without watermarking', () => {
    const plan = getGalleryUploadPlan({
      format: 'webp',
      pages: 4,
      size: 2 * 1024 * 1024,
      watermark: true
    })

    expect(plan).toEqual({
      mode: 'original',
      extension: 'webp',
      contentType: 'image/webp',
      skipWatermark: true
    })
  })

  it('stores animated AVIF originals without watermarking', () => {
    const plan = getGalleryUploadPlan({
      format: 'heif',
      pages: 2,
      size: 2 * 1024 * 1024,
      watermark: true,
      isAvifSequence: true
    })

    expect(plan).toEqual({
      mode: 'original',
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: true
    })
  })

  it('processes static images through the AVIF transform path', () => {
    const plan = getGalleryUploadPlan({
      format: 'png',
      pages: 1,
      size: 512 * 1024,
      watermark: true
    })

    expect(plan).toEqual({
      mode: 'processed',
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: false
    })
  })

  it('rejects animated originals over the gallery animated size limit', () => {
    const plan = getGalleryUploadPlan({
      format: 'webp',
      pages: 3,
      size: (GALLERY_ANIMATED_MAX_SIZE_MB * 1024 * 1024) + 1,
      watermark: false
    })

    expect(plan).toBe(`动图体积过大, 超过 ${GALLERY_ANIMATED_MAX_SIZE_MB}MB`)
  })

  it('returns animated WebP original buffers and ignores watermarking', async () => {
    const pipeline = createSharpPipeline({ format: 'webp', pages: 3 })
    const original = Buffer.from('animated-webp')

    const result = await preparePatchGalleryImage(
      toExactArrayBuffer(original),
      true
    )

    expect(result).toEqual({
      buffer: original,
      extension: 'webp',
      contentType: 'image/webp',
      skipWatermark: true
    })
    expect(pipeline.resize).not.toHaveBeenCalled()
    expect(pipeline.composite).not.toHaveBeenCalled()
    expect(pipeline.avif).not.toHaveBeenCalled()
  })

  it('returns animated AVIF original buffers without decoding through Sharp', async () => {
    const original = createAnimatedAvifHeader()
    sharpMock.mockImplementation(() => {
      throw new Error('animated AVIF should not be decoded')
    })

    const result = await preparePatchGalleryImage(
      toExactArrayBuffer(original),
      true
    )

    expect(result).toEqual({
      buffer: original,
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: true
    })
    expect(sharpMock).not.toHaveBeenCalled()
  })

  it('transforms static images to AVIF and applies requested watermarking', async () => {
    const pipeline = createSharpPipeline({ format: 'png', pages: 1 })

    const result = await preparePatchGalleryImage(
      toExactArrayBuffer(Buffer.from('static-png')),
      true
    )

    expect(result).toEqual({
      buffer: Buffer.from('processed-image'),
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: false
    })
    expect(pipeline.resize).toHaveBeenCalledWith(1920, 1080, {
      fit: 'inside',
      withoutEnlargement: true
    })
    expect(pipeline.composite).toHaveBeenCalledOnce()
    expect(pipeline.avif).toHaveBeenCalledWith({ quality: 60, effort: 3 })
  })

  it('uploads animated originals with their original extension and content type', async () => {
    createSharpPipeline({ format: 'webp', pages: 3 })
    const original = Buffer.from('animated-webp')

    const result = await uploadPatchGalleryImage(
      toExactArrayBuffer(original),
      123,
      456,
      true
    )

    expect(result).toEqual({
      extension: 'webp',
      contentType: 'image/webp',
      skipWatermark: true
    })
    expect(uploadImageToS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/456.webp',
      original,
      'image/webp'
    )
  })
})
