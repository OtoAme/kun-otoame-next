import { beforeEach, describe, expect, it, vi } from 'vitest'

const sharpMock = vi.hoisted(() => vi.fn())
const uploadImageToS3Mock = vi.hoisted(() => vi.fn())
const deleteFileFromS3Mock = vi.hoisted(() => vi.fn())
const createAnimatedAvifThumbnailMock = vi.hoisted(() => vi.fn())

vi.mock('sharp', () => ({
  default: sharpMock
}))

vi.mock('~/lib/s3', () => ({
  uploadImageToS3: uploadImageToS3Mock,
  deleteFileFromS3: deleteFileFromS3Mock
}))

vi.mock('~/app/api/edit/galleryAnimatedAvifThumbnail', () => ({
  createAnimatedAvifThumbnail: createAnimatedAvifThumbnailMock
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
    webp: vi.fn().mockReturnThis(),
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
    vi.resetAllMocks()
    deleteFileFromS3Mock.mockResolvedValue(undefined)
    createAnimatedAvifThumbnailMock.mockResolvedValue(null)
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
    const metadataPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3,
      loop: 0,
      delay: [80, 90, 100]
    })
    const thumbnailPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3,
      loop: 0,
      delay: [80, 90, 100]
    })
    const original = Buffer.from('animated-webp-original-buffer')

    sharpMock.mockReturnValueOnce(metadataPipeline)
    sharpMock.mockReturnValueOnce(thumbnailPipeline)

    const result = await preparePatchGalleryImage(
      toExactArrayBuffer(original),
      true
    )

    expect(result).toEqual({
      buffer: original,
      extension: 'webp',
      contentType: 'image/webp',
      thumbnailBuffer: Buffer.from('processed-image'),
      thumbnailExtension: 'webp',
      thumbnailContentType: 'image/webp',
      skipWatermark: true
    })
    expect(metadataPipeline.resize).not.toHaveBeenCalled()
    expect(metadataPipeline.composite).not.toHaveBeenCalled()
    expect(metadataPipeline.avif).not.toHaveBeenCalled()
    expect(thumbnailPipeline.resize).toHaveBeenCalledWith({
      width: 360,
      height: 240,
      fit: 'inside',
      withoutEnlargement: true
    })
    expect(thumbnailPipeline.webp).toHaveBeenCalledWith({
      quality: 75,
      effort: 6,
      minSize: true,
      loop: 0,
      delay: [80, 90, 100]
    })
  })

  it('caps animated WebP thumbnail frame height by the WebP canvas dimension limit', async () => {
    const metadataPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 100
    })
    const thumbnailPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 100
    })
    sharpMock.mockReturnValueOnce(metadataPipeline)
    sharpMock.mockReturnValueOnce(thumbnailPipeline)

    await preparePatchGalleryImage(
      toExactArrayBuffer(Buffer.from('many-frame-webp')),
      true
    )

    expect(thumbnailPipeline.resize).toHaveBeenCalledWith({
      width: 360,
      height: 163,
      fit: 'inside',
      withoutEnlargement: true
    })
  })

  it('keeps animated WebP thumbnails even when the encoded thumbnail is not smaller than the original', async () => {
    const metadataPipeline = createSharpPipeline({
      format: 'webp',
      width: 120,
      pageHeight: 80,
      pages: 2
    })
    const thumbnailPipeline = createSharpPipeline({
      format: 'webp',
      width: 120,
      pageHeight: 80,
      pages: 2
    })
    thumbnailPipeline.toBuffer.mockResolvedValue(
      Buffer.from('larger-than-original-thumbnail')
    )
    sharpMock.mockReturnValueOnce(metadataPipeline)
    sharpMock.mockReturnValueOnce(thumbnailPipeline)
    const original = Buffer.from('small-webp')

    const result = await preparePatchGalleryImage(
      toExactArrayBuffer(original),
      true
    )

    expect(result).toEqual({
      buffer: original,
      extension: 'webp',
      contentType: 'image/webp',
      thumbnailBuffer: Buffer.from('larger-than-original-thumbnail'),
      thumbnailExtension: 'webp',
      thumbnailContentType: 'image/webp',
      skipWatermark: true
    })
    expect(thumbnailPipeline.webp).toHaveBeenCalled()
  })

  it('returns animated AVIF original buffers with a real generated thumbnail when the encoder succeeds', async () => {
    const original = createAnimatedAvifHeader()
    const thumbnail = Buffer.from('animated-avif-thumbnail')
    createAnimatedAvifThumbnailMock.mockResolvedValue(thumbnail)
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
      thumbnailBuffer: thumbnail,
      thumbnailExtension: 'avif',
      thumbnailContentType: 'image/avif',
      skipWatermark: true
    })
    expect(createAnimatedAvifThumbnailMock).toHaveBeenCalledWith(original)
    expect(sharpMock).not.toHaveBeenCalled()
  })

  it('keeps animated AVIF originals when thumbnail generation is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = createAnimatedAvifHeader()
    createAnimatedAvifThumbnailMock.mockRejectedValue(new Error('no encoder'))
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
    expect(consoleError).toHaveBeenCalledWith(
      'Animated AVIF thumbnail generation error:',
      expect.any(Error)
    )
    expect(sharpMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('transforms static images to AVIF and applies requested watermarking', async () => {
    const metadataPipeline = createSharpPipeline({ format: 'png', pages: 1 })
    const originalPipeline = createSharpPipeline({ format: 'png', pages: 1 })
    const thumbnailPipeline = createSharpPipeline({ format: 'avif', pages: 1 })
    sharpMock
      .mockReturnValueOnce(metadataPipeline)
      .mockReturnValueOnce(originalPipeline)
      .mockReturnValueOnce(thumbnailPipeline)

    const result = await preparePatchGalleryImage(
      toExactArrayBuffer(Buffer.from('static-png')),
      true
    )

    expect(result).toEqual({
      buffer: Buffer.from('processed-image'),
      extension: 'avif',
      contentType: 'image/avif',
      thumbnailBuffer: Buffer.from('processed-image'),
      thumbnailExtension: 'avif',
      thumbnailContentType: 'image/avif',
      skipWatermark: false
    })
    expect(originalPipeline.resize).toHaveBeenCalledWith(1920, 1080, {
      fit: 'inside',
      withoutEnlargement: true
    })
    expect(thumbnailPipeline.resize).toHaveBeenCalledWith(360, 240, {
      fit: 'inside',
      withoutEnlargement: true
    })
    expect(originalPipeline.composite).toHaveBeenCalledOnce()
    expect(originalPipeline.avif).toHaveBeenCalledWith({
      quality: 60,
      effort: 3
    })
    expect(thumbnailPipeline.avif).toHaveBeenCalledWith({
      quality: 50,
      effort: 2
    })
  })

  it('uploads animated originals and thumbnails with their own extensions and content types', async () => {
    const metadataPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3
    })
    const thumbnailPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3
    })
    sharpMock.mockReturnValueOnce(metadataPipeline)
    sharpMock.mockReturnValueOnce(thumbnailPipeline)
    const original = Buffer.from('animated-webp-original-buffer')

    const result = await uploadPatchGalleryImage(
      toExactArrayBuffer(original),
      123,
      456,
      true
    )

    expect(result).toEqual({
      extension: 'webp',
      contentType: 'image/webp',
      thumbnailExtension: 'webp',
      thumbnailContentType: 'image/webp',
      skipWatermark: true
    })
    expect(uploadImageToS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/456.webp',
      original,
      'image/webp'
    )
    expect(uploadImageToS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/thumbnail/thumb-456.webp',
      Buffer.from('processed-image'),
      'image/webp'
    )
  })

  it('keeps animated WebP originals when thumbnail generation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const metadataPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3
    })
    const thumbnailPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3
    })
    thumbnailPipeline.toBuffer.mockRejectedValue(new Error('thumbnail failed'))
    sharpMock.mockReturnValueOnce(metadataPipeline)
    sharpMock.mockReturnValueOnce(thumbnailPipeline)
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
    expect(consoleError).toHaveBeenCalledWith(
      'Animated WebP thumbnail generation error:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })

  it('does not fail animated WebP uploads when thumbnail upload fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const metadataPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3
    })
    const thumbnailPipeline = createSharpPipeline({
      format: 'webp',
      width: 720,
      pageHeight: 480,
      pages: 3
    })
    sharpMock.mockReturnValueOnce(metadataPipeline)
    sharpMock.mockReturnValueOnce(thumbnailPipeline)
    uploadImageToS3Mock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('thumbnail failed'))

    await expect(
      uploadPatchGalleryImage(
        toExactArrayBuffer(Buffer.from('animated-webp-original-buffer')),
        123,
        456,
        true
      )
    ).resolves.toEqual({
      extension: 'webp',
      contentType: 'image/webp',
      skipWatermark: true
    })

    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Animated WebP thumbnail upload error:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })

  it('deletes a static original when static thumbnail upload fails', async () => {
    const metadataPipeline = createSharpPipeline({ format: 'png', pages: 1 })
    const originalPipeline = createSharpPipeline({ format: 'png', pages: 1 })
    const thumbnailPipeline = createSharpPipeline({ format: 'avif', pages: 1 })
    sharpMock
      .mockReturnValueOnce(metadataPipeline)
      .mockReturnValueOnce(originalPipeline)
      .mockReturnValueOnce(thumbnailPipeline)
    uploadImageToS3Mock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('thumbnail upload failed'))

    await expect(
      uploadPatchGalleryImage(
        toExactArrayBuffer(Buffer.from('static-png')),
        123,
        456,
        true
      )
    ).rejects.toThrow('thumbnail upload failed')

    expect(deleteFileFromS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/456.avif'
    )
  })

  it('uploads animated AVIF originals and real generated thumbnail objects', async () => {
    const original = createAnimatedAvifHeader()
    createAnimatedAvifThumbnailMock.mockResolvedValue(
      Buffer.from('animated-avif-thumbnail')
    )

    const result = await uploadPatchGalleryImage(
      toExactArrayBuffer(original),
      123,
      456,
      true
    )

    expect(result).toEqual({
      extension: 'avif',
      contentType: 'image/avif',
      thumbnailExtension: 'avif',
      thumbnailContentType: 'image/avif',
      skipWatermark: true
    })
    expect(uploadImageToS3Mock).toHaveBeenCalledTimes(2)
    expect(uploadImageToS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/456.avif',
      original,
      'image/avif'
    )
    expect(uploadImageToS3Mock).toHaveBeenCalledWith(
      'patch/123/gallery/thumbnail/thumb-456.avif',
      Buffer.from('animated-avif-thumbnail'),
      'image/avif'
    )
  })

  it('does not fail animated AVIF uploads when thumbnail upload fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    createAnimatedAvifThumbnailMock.mockResolvedValue(
      Buffer.from('animated-avif-thumbnail')
    )
    uploadImageToS3Mock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('thumbnail failed'))

    await expect(
      uploadPatchGalleryImage(
        toExactArrayBuffer(createAnimatedAvifHeader()),
        123,
        456,
        true
      )
    ).resolves.toEqual({
      extension: 'avif',
      contentType: 'image/avif',
      skipWatermark: true
    })

    expect(deleteFileFromS3Mock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Animated AVIF thumbnail upload error:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })
})
