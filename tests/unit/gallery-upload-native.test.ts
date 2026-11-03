import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { getSharp } from 'next/dist/server/image-optimizer'

vi.mock('~/lib/s3', () => ({
  uploadImageToS3: vi.fn(),
  deleteFileFromS3: vi.fn()
}))

vi.mock('~/app/api/edit/galleryAnimatedAvifThumbnail', () => ({
  createAnimatedAvifThumbnail: vi.fn()
}))

import { preparePatchGalleryImage } from '~/app/api/edit/galleryUpload'

const toExactArrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer

describe('gallery upload with native image decoders', () => {
  it('prepares valid images while Next initializes its shared decoder policy', async () => {
    const source = () =>
      sharp({
        create: {
          width: 240,
          height: 240,
          channels: 3,
          background: '#e477aa'
        }
      })
    const inputs = await Promise.all([
      source().jpeg().toBuffer(),
      source().png().toBuffer(),
      source().webp().toBuffer(),
      source().avif().toBuffer()
    ])

    // Preview requests can initialize Next's loader policy while uploads are
    // already decoding. Use the installed Next and Sharp, with no real storage.
    const jobs = Array.from({ length: 48 }, (_, index) =>
      preparePatchGalleryImage(
        toExactArrayBuffer(inputs[index % inputs.length]),
        index % 2 === 0
      )
    )
    getSharp(undefined)

    for (const result of await Promise.all(jobs)) {
      expect(result).toMatchObject({
        extension: 'avif',
        thumbnailExtension: 'avif'
      })
      if (typeof result === 'string') throw new Error(result)
      expect(await sharp(result.buffer).metadata()).toMatchObject({
        format: 'heif',
        width: 240,
        height: 240
      })
      expect(await sharp(result.thumbnailBuffer!).metadata()).toMatchObject({
        format: 'heif',
        width: 240,
        height: 240
      })
    }
  })

  it('uploads a third PNG after AVIF decoding becomes unavailable in the process', async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: '#e477aa'
      }
    })
      .png()
      .toBuffer()

    for (let index = 0; index < 2; index++) {
      expect(
        await preparePatchGalleryImage(toExactArrayBuffer(source), true)
      ).toMatchObject({ extension: 'avif', thumbnailExtension: 'avif' })
    }

    // Next disables HEIF loading when its runtime safety check fails. PNG
    // uploads must not require decoding their newly encoded AVIF output.
    sharp.block({ operation: ['VipsForeignLoadHeif'] })
    let result: Awaited<ReturnType<typeof preparePatchGalleryImage>>
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await sharp(source).metadata()).toMatchObject({ format: 'png' })
      result = await preparePatchGalleryImage(toExactArrayBuffer(source), true)
    } finally {
      sharp.unblock({ operation: ['VipsForeignLoadHeif'] })
      consoleError.mockRestore()
    }

    expect(result).toMatchObject({
      extension: 'avif',
      thumbnailExtension: 'avif'
    })
    if (typeof result === 'string') throw new Error(result)
    expect(await sharp(result.buffer).metadata()).toMatchObject({
      format: 'heif'
    })
    expect(await sharp(result.thumbnailBuffer!).metadata()).toMatchObject({
      format: 'heif',
      width: 360,
      height: 203
    })
  })

  it.each([false, true])(
    'preserves transparency in both outputs with watermark=%s',
    async (watermark) => {
      const source = await sharp({
        create: {
          width: 400,
          height: 400,
          channels: 4,
          background: { r: 220, g: 100, b: 160, alpha: 0.5 }
        }
      })
        .png()
        .toBuffer()
      const result = await preparePatchGalleryImage(
        toExactArrayBuffer(source),
        watermark
      )
      expect(result).toMatchObject({
        extension: 'avif',
        thumbnailExtension: 'avif'
      })
      if (typeof result === 'string') throw new Error(result)

      for (const [buffer, size] of [
        [result.buffer, 400],
        [result.thumbnailBuffer!, 240]
      ] as const) {
        expect(await sharp(buffer).metadata()).toMatchObject({
          width: size,
          height: size,
          hasAlpha: true
        })
        const stats = await sharp(buffer).stats()
        expect(stats.channels[3].mean).toBeGreaterThanOrEqual(127)
        expect(stats.channels[3].mean).toBeLessThan(130)
      }
    }
  )
})
