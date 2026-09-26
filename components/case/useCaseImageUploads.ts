'use client'

import { useCallback, useState } from 'react'
import { kunFetchFormData } from '~/utils/kunFetch'
import { CASE_IMAGE_MAX_PER_MESSAGE } from '~/constants/case'
import type { CaseImageUploadResponse } from '~/types/api/case'

/**
 * Draft images for one case note (D11). Shared by the HeroUI site entries and
 * the shadcn /issue page, so it holds no UI library. Each file uploads on its
 * own; the first failure stops the batch and keeps what already succeeded.
 */
export const useCaseImageUploads = () => {
  const [images, setImages] = useState<CaseImageUploadResponse[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const add = useCallback(
    async (files: FileList | File[]) => {
      const room = CASE_IMAGE_MAX_PER_MESSAGE - images.length
      const picked = Array.from(files).slice(0, Math.max(0, room))
      if (!picked.length) {
        setError(`每条说明最多 ${CASE_IMAGE_MAX_PER_MESSAGE} 张图片`)
        return
      }
      setUploading(true)
      setError('')
      const uploaded: CaseImageUploadResponse[] = []
      for (const file of picked) {
        const formData = new FormData()
        formData.append('image', file)
        try {
          const result = await kunFetchFormData<
            CaseImageUploadResponse | string
          >('/case/image', formData)
          if (typeof result === 'string') {
            setError(result || '图片上传失败，请重试')
            break
          }
          uploaded.push(result)
        } catch {
          setError('网络错误，图片上传失败，请重试')
          break
        }
      }
      setImages((current) =>
        [...current, ...uploaded].slice(0, CASE_IMAGE_MAX_PER_MESSAGE)
      )
      setUploading(false)
    },
    [images.length]
  )

  const remove = useCallback((key: string) => {
    setImages((current) => current.filter((image) => image.key !== key))
  }, [])

  const reset = useCallback(() => {
    setImages([])
    setError('')
  }, [])

  return {
    images,
    keys: images.map((image) => image.key),
    uploading,
    error,
    full: images.length >= CASE_IMAGE_MAX_PER_MESSAGE,
    add,
    remove,
    reset
  }
}
