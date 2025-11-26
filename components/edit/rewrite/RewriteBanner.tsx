'use client'

import { useEffect, useState } from 'react'
import { dataURItoBlob } from '~/utils/dataURItoBlob'
import { KunImageCropper } from '~/components/kun/cropper/KunImageCropper'
import { useRewritePatchStore } from '~/store/rewriteStore'

export const RewriteBanner = () => {
    const { data, newBanner, setNewBanner } = useRewritePatchStore()
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
    }

    const onImageComplete = (croppedImage: string) => {
        const imageBlob = dataURItoBlob(croppedImage)
        const file = new File([imageBlob], 'banner.avif', { type: 'image/avif' })
        setNewBanner(file)
    }

    return (
        <div className="space-y-2">
            <h2 className="text-xl">封面图片 (可选)</h2>
            <KunImageCropper
                aspect={{ x: 16, y: 9 }}
                initialImage={initialUrl}
                description="您的预览图片将会被固定为 1920 × 1080 分辨率"
                onImageComplete={onImageComplete}
                removeImage={removeBanner}
            />
        </div>
    )
}
