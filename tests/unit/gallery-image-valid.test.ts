import { afterEach, describe, expect, it, vi } from 'vitest'
import { GALLERY_IMAGE_MAX_SIZE_MB } from '~/constants/galgame'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('react-hot-toast', () => ({
  default: { error: toastError }
}))

const { checkImageValid } = await import('~/utils/resizeImage')

const createFile = (type: string, sizeInBytes: number) => {
  const file = new File([Buffer.from('x')], 'gallery-image', { type })
  Object.defineProperty(file, 'size', { value: sizeInBytes })
  return file
}

const MAX_BYTES = GALLERY_IMAGE_MAX_SIZE_MB * 1024 * 1024

describe('checkImageValid', () => {
  afterEach(() => {
    toastError.mockClear()
  })

  it('accepts a supported image at exactly the size limit', () => {
    expect(checkImageValid(createFile('image/png', MAX_BYTES))).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('rejects an oversized image before it can reach the upload request', () => {
    expect(checkImageValid(createFile('image/png', MAX_BYTES + 1))).toBe(false)
    expect(toastError).toHaveBeenCalledWith(
      `单张图片不能超过 ${GALLERY_IMAGE_MAX_SIZE_MB} MB, 请压缩后再上传`
    )
  })

  it('still rejects unsupported types and reports the type problem first', () => {
    expect(checkImageValid(createFile('image/gif', MAX_BYTES + 1))).toBe(false)
    expect(toastError).toHaveBeenCalledWith(
      '我们仅支持 jpg, png, webp, avif 图片'
    )
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
