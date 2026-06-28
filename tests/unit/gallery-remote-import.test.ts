import { describe, expect, it, vi } from 'vitest'

import { importRemoteGalleryImage } from '~/app/api/edit/galleryRemoteImport'

const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43])

const createResponse = (
  body: Buffer,
  init: { status?: number; headers?: Record<string, string> } = {}
) =>
  new Response(body, {
    status: init.status ?? 200,
    headers: init.headers
  })

describe('remote gallery image import', () => {
  it('downloads a browser-dragged image URL and trusts image magic bytes when the header is generic', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      createResponse(jpegBuffer, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(jpegBuffer.byteLength)
        }
      })
    )
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    const result = await importRemoteGalleryImage(
      'https://img.example/path/sample.jpg',
      { fetchImpl, lookup }
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://img.example/path/sample.jpg',
      expect.objectContaining({ redirect: 'manual' })
    )
    expect(result).toEqual({
      fileName: 'sample.jpg',
      contentType: 'image/jpeg',
      base64: jpegBuffer.toString('base64')
    })
  })

  it('rejects localhost and private network targets before fetching', async () => {
    const fetchImpl = vi.fn()
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    await expect(
      importRemoteGalleryImage('https://localhost/sample.jpg', {
        fetchImpl,
        lookup
      })
    ).resolves.toBe('不支持导入内网图片地址')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('validates every redirect target against the same SSRF rules', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      createResponse(Buffer.from(''), {
        status: 302,
        headers: { location: 'http://127.0.0.1/private.jpg' }
      })
    )
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])

    await expect(
      importRemoteGalleryImage('https://img.example/sample.jpg', {
        fetchImpl,
        lookup
      })
    ).resolves.toBe('不支持导入内网图片地址')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized remote images from content-length before reading the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      createResponse(Buffer.from('too-large'), {
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(9 * 1024 * 1024)
        }
      })
    )
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    await expect(
      importRemoteGalleryImage('https://img.example/large.jpg', {
        fetchImpl,
        lookup
      })
    ).resolves.toBe('远程图片体积过大, 超过 8MB')
  })

  it('rejects responses whose headers and bytes are not supported images', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      createResponse(Buffer.from('<html></html>'), {
        headers: { 'content-type': 'text/html' }
      })
    )
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    await expect(
      importRemoteGalleryImage('https://img.example/not-image', {
        fetchImpl,
        lookup
      })
    ).resolves.toBe('远程地址不是支持的图片')
  })
})
