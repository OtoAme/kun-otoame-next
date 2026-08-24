'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { dataURItoBlob } from '~/utils/dataURItoBlob'
import { compressDataURLToWebp } from '~/utils/resizeImage'
import { KunImageCropper } from '~/components/kun/cropper/KunImageCropper'
import { useRewritePatchStore } from '~/store/rewriteStore'

const MAX_ORIGINAL_BANNER_SIZE = 4 * 1024 * 1024

export const RewriteBanner = () => {
    const { data, newBanner, setNewBanner, setNewBannerOriginal } =
        useRewritePatchStore()
    const [initialUrl, setInitialUrl] = useState<string>('')

    useEffect(() => {
        if (newBanner) {
            setInitialUrl(URL.createObjectURL(newBanner))
        } else if (data.bannerUrl) {
            setInitialUrl(data.bannerUrl)
        }
    }, [data.bannerUrl, newBanner])

    const removeBanner = () => {
        setNewBanner(null)
        setNewBannerOriginal(null)
    }

    const onImageComplete = (croppedImage: string) => {
        const imageBlob = dataURItoBlob(croppedImage)
        const file = new File([imageBlob], 'banner.avif', { type: 'image/avif' })
        setNewBanner(file)
    }

    const onOriginalImageComplete = async (originalImage: string) => {
        try {
            const imageBlob = await compressDataURLToWebp(originalImage, {
                maxSizeBytes: MAX_ORIGINAL_BANNER_SIZE
            })
            setNewBannerOriginal(
                new File([imageBlob], 'banner-original.webp', {
                    type: imageBlob.type
                })
            )
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '原图处理失败')
            setNewBannerOriginal(null)
        }
    }

    return (
        <div className="space-y-2">
            <h2 className="text-xl">封面图片 (可选)</h2>
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
