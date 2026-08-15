import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  buildStickerId,
  extractStickerZip,
  getStickerAssetKey,
  getStickerFfmpegFailureReason,
  getStickerEstimatedFrameCount,
  getStickerPosterKey,
  getStickerWebmInputArgs,
  hasStickerWebmAlpha,
  parseStickerAsset,
  STICKER_MAX_ZIP_BYTES,
  STICKER_MAX_ZIP_UNCOMPRESSED_BYTES,
  STICKER_MAX_ESTIMATED_FRAMES,
  STICKER_WEBM_MAX_BYTES
} from '~/lib/stickerAssets'

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const createStoredZip = (entries: Array<{ name: string; data: Buffer }>) => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const checksum = crc32(entry.data)
    const local = Buffer.alloc(30 + name.length + entry.data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    entry.data.copy(local, 30 + name.length)
    locals.push(local)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const localDirectory = Buffer.concat(locals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localDirectory.length, 16)
  return Buffer.concat([localDirectory, centralDirectory, end])
}

describe('sticker asset validation', () => {
  it('uses stable content-addressed IDs and object keys', () => {
    const id = buildStickerId('cute_cats', 'Happy Face.webp', 'a'.repeat(64))

    expect(id).toBe('cute_cats_happy_face_aaaaaaaaaaaaaaaaaa')
    expect(getStickerAssetKey('cute_cats', id, 'webp')).toBe(
      `sticker/cute_cats/${id}/asset.webp`
    )
    const poster = Buffer.from('transparent poster')
    const posterHash = createHash('sha256').update(poster).digest('hex')
    expect(getStickerPosterKey('cute_cats', id, poster)).toBe(
      `sticker/cute_cats/${id}/poster-${posterHash.slice(0, 16)}.webp`
    )
  })

  it('accepts real static WebP and rejects a spoofed extension', async () => {
    const webp = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .webp()
      .toBuffer()

    await expect(
      parseStickerAsset({ name: 'red.webp', buffer: webp })
    ).resolves.toMatchObject({ mediaType: 'image', mime: 'image/webp' })
    await expect(
      parseStickerAsset({ name: 'spoof.webp', buffer: Buffer.from('not webp') })
    ).rejects.toThrow('文件真实类型不是 WebP')
  })

  it('extracts safe ZIP entries and rejects traversal or unsupported files', async () => {
    const webp = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 }
      }
    })
      .webp()
      .toBuffer()

    const safeZip = createStoredZip([{ name: 'nested/green.webp', data: webp }])
    await expect(
      extractStickerZip({ name: 'safe.zip', buffer: safeZip })
    ).resolves.toEqual([{ name: 'nested/green.webp', buffer: webp }])

    const traversalZip = createStoredZip([
      { name: '../green.webp', data: webp }
    ])
    await expect(
      extractStickerZip({ name: 'traversal.zip', buffer: traversalZip })
    ).rejects.toThrow(/不能包含 \.\.|invalid relative path/)

    const unsupportedZip = createStoredZip([
      { name: 'readme.txt', data: Buffer.from('nope') }
    ])
    await expect(
      extractStickerZip({ name: 'unsupported.zip', buffer: unsupportedZip })
    ).rejects.toThrow('不是支持的 WebP/WebM 文件')
  })

  it('normalizes a leading-slash archive root without allowing traversal', async () => {
    const webp = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 255, g: 192, b: 203, alpha: 1 }
      }
    })
      .webp()
      .toBuffer()

    const archive = createStoredZip([
      { name: '/5038551553/', data: Buffer.alloc(0) },
      { name: '/5038551553/cute.webp', data: webp }
    ])

    await expect(
      extractStickerZip({ name: 'absolute-root.zip', buffer: archive })
    ).resolves.toEqual([{ name: '5038551553/cute.webp', buffer: webp }])

    const traversal = createStoredZip([{ name: '/../escape.webp', data: webp }])
    await expect(
      extractStickerZip({ name: 'traversal.zip', buffer: traversal })
    ).rejects.toThrow(/不能包含 \.\.|invalid relative path/)

    for (const absoluteName of [
      'C:/Windows/escape.webp',
      '//server/share/escape.webp'
    ]) {
      const absolute = createStoredZip([{ name: absoluteName, data: webp }])
      await expect(
        extractStickerZip({ name: 'absolute.zip', buffer: absolute })
      ).rejects.toThrow('ZIP 条目路径不安全')
    }
  })

  it('keeps the WebM limit at 300 KB', () => {
    expect(STICKER_WEBM_MAX_BYTES).toBe(300 * 1024)
  })

  it('allows 32 MiB ZIP uploads while keeping the 64 MiB extraction limit', () => {
    expect(STICKER_MAX_ZIP_BYTES).toBe(32 * 1024 * 1024)
    expect(STICKER_MAX_ZIP_UNCOMPRESSED_BYTES).toBe(64 * 1024 * 1024)
  })

  it('uses a frame budget so short Telegram-exported WebM files are accepted', () => {
    expect(STICKER_MAX_ESTIMATED_FRAMES).toBe(100)
    expect(getStickerEstimatedFrameCount(3_000, 30)).toBe(90)
    expect(getStickerEstimatedFrameCount(3_000, 30.33)).toBe(91)
    expect(getStickerEstimatedFrameCount(80, 50)).toBe(4)
    expect(getStickerEstimatedFrameCount(3_000, 50)).toBe(150)
    expect(getStickerEstimatedFrameCount(null, 30)).toBeNull()
  })

  it('recognizes VP9 alpha metadata and forces the alpha-capable decoder', () => {
    expect(
      hasStickerWebmAlpha(`
        Stream #0:0: Video: vp9 (Profile 0), yuv420p, 512x512
        Metadata:
          alpha_mode      : 1
      `)
    ).toBe(true)
    expect(
      hasStickerWebmAlpha(
        'Stream #0:0: Video: vp9 (Profile 0), yuva420p, 512x512'
      )
    ).toBe(true)
    expect(
      hasStickerWebmAlpha(
        'Stream #0:0: Video: vp9 (Profile 0), yuv420p, 512x512'
      )
    ).toBe(false)
    expect(getStickerWebmInputArgs('/tmp/sticker.webm')).toEqual([
      '-c:v',
      'libvpx-vp9',
      '-i',
      '/tmp/sticker.webm'
    ])
  })

  it('does not hide a real media validation error behind a missing FFmpeg fallback', () => {
    const missingFallback = Object.assign(new Error('spawn ffmpeg ENOENT'), {
      code: 'ENOENT'
    })

    expect(
      getStickerFfmpegFailureReason(
        '动态 Sticker 估算总帧数不能超过 100 帧',
        missingFallback
      )
    ).toBe('动态 Sticker 估算总帧数不能超过 100 帧')
    expect(
      getStickerFfmpegFailureReason(
        'spawn bundled-ffmpeg ENOENT',
        new Error('动态 Sticker 必须使用 VP9 编码')
      )
    ).toBe('动态 Sticker 必须使用 VP9 编码')
  })
})
