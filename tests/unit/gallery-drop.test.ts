import { describe, expect, it, vi } from 'vitest'

import {
  extractGalleryRemoteImageUrls,
  fileFromGalleryRemoteImport,
  getGalleryFilesFromEvent
} from '~/utils/galleryDrop'

const createDataTransfer = (data: Record<string, string>) =>
  ({
    files: { length: 0 },
    getData: (type: string) => data[type] ?? ''
  }) as DataTransfer

describe('gallery drag and drop helpers', () => {
  it('extracts image URLs from browser image drags that provide text/uri-list', () => {
    const dataTransfer = createDataTransfer({
      'text/uri-list': [
        '# dragged from browser',
        'https://denpasoft.com/cdn-cgi/image/fit=cover,format=auto,quality=85,width=720/wp-content/uploads/2020/09/ss_5d10efc98346220992c14b87863e7ecd57fd13e8.800x600.jpg'
      ].join('\n')
    })

    expect(extractGalleryRemoteImageUrls(dataTransfer)).toEqual([
      'https://denpasoft.com/cdn-cgi/image/fit=cover,format=auto,quality=85,width=720/wp-content/uploads/2020/09/ss_5d10efc98346220992c14b87863e7ecd57fd13e8.800x600.jpg'
    ])
  })

  it('falls back to the img src inside dragged HTML', () => {
    const dataTransfer = createDataTransfer({
      'text/html':
        '<img src="https://img.example/gallery/sample.png" alt="sample">'
    })

    expect(extractGalleryRemoteImageUrls(dataTransfer)).toEqual([
      'https://img.example/gallery/sample.png'
    ])
  })

  it('converts remote import payloads into typed File objects', () => {
    const file = fileFromGalleryRemoteImport({
      fileName: 'sample.jpg',
      contentType: 'image/jpeg',
      base64: Buffer.from('jpeg-bytes').toString('base64')
    })

    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('sample.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe(10)
  })

  it('imports browser-dragged image URLs when no local files are present', async () => {
    const importer = vi.fn().mockResolvedValue({
      fileName: 'sample.jpg',
      contentType: 'image/jpeg',
      base64: Buffer.from('jpeg-bytes').toString('base64')
    })
    const event = {
      dataTransfer: createDataTransfer({
        'text/uri-list': 'https://img.example/gallery/sample.jpg'
      })
    } as DragEvent

    const files = await getGalleryFilesFromEvent(event, importer)

    expect(importer).toHaveBeenCalledWith(
      'https://img.example/gallery/sample.jpg'
    )
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      name: 'sample.jpg',
      type: 'image/jpeg'
    })
  })

  it('surfaces remote import errors for URL-only browser image drags', async () => {
    const importer = vi.fn().mockResolvedValue('远程地址不是支持的图片')
    const event = {
      dataTransfer: createDataTransfer({
        'text/uri-list': 'https://img.example/gallery/sample.jpg'
      })
    } as DragEvent

    await expect(getGalleryFilesFromEvent(event, importer)).rejects.toThrow(
      '远程地址不是支持的图片'
    )
  })
})
