'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { dataURItoBlob } from '~/utils/dataURItoBlob'
import { compressDataURLToWebp } from '~/utils/resizeImage'
import { KunImageCropper } from '~/components/kun/cropper/KunImageCropper'
import { kunFetchFormData } from '~/utils/kunFetch'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'

const MAX_ORIGINAL_BANNER_SIZE = 4 * 1024 * 1024

export const SubmissionBannerInput = () => {
  const { submissionId, bannerUrl, setBannerUrl } = usePatchSubmissionStore()
  const [cropped, setCropped] = useState<File | null>(null)
  const [original, setOriginal] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const onImageComplete = (croppedImage: string) => {
    const blob = dataURItoBlob(croppedImage)
    setCropped(new File([blob], 'banner.avif', { type: 'image/avif' }))
  }

  const onOriginalImageComplete = async (originalImage: string) => {
    try {
      const blob = await compressDataURLToWebp(originalImage, {
        maxSizeBytes: MAX_ORIGINAL_BANNER_SIZE
      })
      setOriginal(new File([blob], 'banner-original.webp', { type: blob.type }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '原图处理失败')
      setOriginal(null)
    }
  }

  const upload = async () => {
    if (!cropped) {
      toast.error('请先选择并裁剪封面')
      return
    }
    // banner-full.avif is only written when the original is present, so allowing
    // an upload without it would publish an entry whose lightbox image is
    // missing.
    if (!original) {
      toast.error('封面原图缺失, 请重新裁剪封面')
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.set('kind', 'banner')
    formData.set('submissionId', String(submissionId))
    formData.set('banner', cropped)
    formData.set('bannerOriginal', original)

    try {
      const response = await kunFetchFormData<string | { bannerKey: string }>(
        '/patch-submission/asset',
        formData
      )
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      setBannerUrl(
        `${process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL}/${response.bannerKey}`
      )
      setCropped(null)
      setOriginal(null)
      toast.success('封面已保存')
    } catch (error) {
      console.error('Failed to upload the submission banner', error)
      toast.error('封面上传失败, 请检查网络后重试')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl">封面图片 (必须)</h2>
      <KunImageCropper
        aspect={{ x: 16, y: 9 }}
        initialImage={bannerUrl ?? ''}
        description="您的预览图片将会被固定为 1920 × 1080 分辨率"
        onImageComplete={onImageComplete}
        onOriginalImageComplete={onOriginalImageComplete}
        removeImage={() => {
          setCropped(null)
          setOriginal(null)
        }}
      />
      {cropped && (
        <button
          type="button"
          onClick={() => void upload()}
          disabled={uploading}
          className="px-4 py-2 text-sm font-medium text-white rounded-medium bg-primary disabled:opacity-50"
        >
          {uploading ? '正在上传封面 ...' : '保存封面'}
        </button>
      )}
    </div>
  )
}
