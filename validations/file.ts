import { z } from 'zod'

const isBlobLike = (value: unknown): value is Blob =>
  typeof Blob !== 'undefined' && value instanceof Blob

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

export const nonEmptyFileSchema = z
  .custom<Blob>((value) => isBlobLike(value), {
    message: '请上传文件'
  })
  .refine((file) => file.size > 0, {
    message: '上传文件不能为空'
  })
  .refine((file) => file.size <= MAX_IMAGE_SIZE_BYTES, {
    message: '图片大小不能超过 10 MB'
  })
