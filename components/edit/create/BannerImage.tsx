'use client'

import { useEffect, useState } from 'react'
import localforage from 'localforage'
import toast from 'react-hot-toast'
import { dataURItoBlob } from '~/utils/dataURItoBlob'
import { compressDataURLToWebp } from '~/utils/resizeImage'
import { KunImageCropper } from '~/components/kun/cropper/KunImageCropper'
import {
  CREATE_PATCH_BANNER_KEY,
  CREATE_PATCH_ORIGINAL_BANNER_KEY
} from '~/utils/createPatchDraft'

const MAX_ORIGINAL_BANNER_SIZE = 4 * 1024 * 1024

interface Props {
  errors: string | undefined
}

export const BannerImage = ({ errors }: Props) => {
  const [initialUrl, setInitialUrl] = useState<string>('')

  useEffect(() => {
    const fetchData = async () => {
      const localeBannerBlob: Blob | null = await localforage.getItem(
        CREATE_PATCH_BANNER_KEY
      )
      if (localeBannerBlob) {
        setInitialUrl(URL.createObjectURL(localeBannerBlob))
      }
    }
    fetchData()
  }, [])

  const removeBanner = async () => {
    await localforage.removeItem(CREATE_PATCH_BANNER_KEY)
    await localforage.removeItem(CREATE_PATCH_ORIGINAL_BANNER_KEY)
    setInitialUrl('')
  }

  const onImageComplete = async (croppedImage: string) => {
    const imageBlob = dataURItoBlob(croppedImage)
    await localforage.setItem(CREATE_PATCH_BANNER_KEY, imageBlob)
  }

  const onOriginalImageComplete = async (originalImage: string) => {
    try {
      const imageBlob = await compressDataURLToWebp(originalImage, {
        maxSizeBytes: MAX_ORIGINAL_BANNER_SIZE
      })
      await localforage.setItem(CREATE_PATCH_ORIGINAL_BANNER_KEY, imageBlob)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '原图处理失败')
      await localforage.removeItem(CREATE_PATCH_ORIGINAL_BANNER_KEY)
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl">封面图片 (必须)</h2>
      {errors && <p className="text-xs text-danger-500">{errors}</p>}

      <KunImageCropper
        aspect={{ x: 16, y: 9 }}
        initialImage={initialUrl}
        description="您的预览图片将会被固定为 1920 × 1080 分辨率"
        onImageComplete={onImageComplete}
        onOriginalImageComplete={onOriginalImageComplete}
        removeImage={removeBanner}
      />
    </div>
  )
}
