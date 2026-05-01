'use client'

import { useState } from 'react'
import { Button } from '@heroui/react'
import localforage from 'localforage'
import { useCreatePatchStore } from '~/store/editStore'
import toast from 'react-hot-toast'
import { kunFetchFormData } from '~/utils/kunFetch'
import { kunErrorHandler } from '~/utils/kunErrorHandler'
import { patchCreateSchema } from '~/validations/edit'
import { useRouter } from '@bprogress/next'
import { cn } from '~/utils/cn'
import type { Dispatch, SetStateAction } from 'react'
import type { CreatePatchRequestData } from '~/store/editStore'
import type { GalleryImage } from './GalleryInput'

interface Props {
  setErrors: Dispatch<
    SetStateAction<Partial<Record<keyof CreatePatchRequestData, string>>>
  >
  className?: string
}

const uploadGalleryImages = async (
  patchId: number,
  galleryImages: GalleryImage[],
  watermark: boolean
) => {
  let successCount = 0
  let failCount = 0

  for (const [index, img] of galleryImages.entries()) {
    const formData = new FormData()
    formData.append('patchId', patchId.toString())
    formData.append('image', img.blob)
    formData.append('isNSFW', String(img.isNSFW))
    formData.append('watermark', String(watermark))
    formData.append('displayOrder', index.toString())

    try {
      const res = await kunFetchFormData<
        KunResponse<{ imageId: number; url: string }>
      >('/edit/gallery', formData, 60000)
      if (typeof res === 'string') {
        failCount++
        console.error(`Gallery image ${index + 1} failed:`, res)
      } else {
        successCount++
      }
    } catch {
      failCount++
      console.error(`Gallery image ${index + 1} upload error`)
    }

    toast(`正在上传图片 ${index + 1}/${galleryImages.length}`, { id: 'gallery-progress' })
  }

  return { successCount, failCount }
}

export const PublishButton = ({ setErrors, className }: Props) => {
  const router = useRouter()
  const { data, resetData } = useCreatePatchStore()

  const [creating, setCreating] = useState(false)
  const handleSubmit = async () => {
    const localeBannerBlob: Blob | null =
      await localforage.getItem('kun-patch-banner')
    const localeOriginalBannerBlob: Blob | null = await localforage.getItem(
      'kun-patch-banner-original'
    )
    if (!localeBannerBlob) {
      toast.error('未检测到预览图片')
      return
    }

    const result = patchCreateSchema.safeParse({
      ...data,
      banner: localeBannerBlob,
      alias: JSON.stringify(data.alias),
      tag: JSON.stringify(data.tag),
      isDuplicate: String(data.isDuplicate)
    })
    if (!result.success) {
      const newErrors: Partial<Record<keyof CreatePatchRequestData, string>> =
        {}
      result.error.errors.forEach((err) => {
        if (err.path.length) {
          newErrors[err.path[0] as keyof CreatePatchRequestData] = err.message
          toast.error(err.message)
        }
      })
      setErrors(newErrors)
      return
    } else {
      setErrors({})
    }

    const formDataToSend = new FormData()
    formDataToSend.append('banner', localeBannerBlob!)
    if (localeOriginalBannerBlob) {
      formDataToSend.append('bannerOriginal', localeOriginalBannerBlob)
    }
    formDataToSend.append('name', data.name)
    formDataToSend.append('vndbId', data.vndbId)
    formDataToSend.append('vndbRelationId', data.vndbRelationId ?? '')
    formDataToSend.append('dlsiteCode', data.dlsiteCode ?? '')
    formDataToSend.append('introduction', data.introduction)
    formDataToSend.append('alias', JSON.stringify(data.alias))
    formDataToSend.append('tag', JSON.stringify(data.tag))
    formDataToSend.append('released', data.released)
    formDataToSend.append('contentLimit', data.contentLimit)
    if (data.officialUrl) formDataToSend.append('officialUrl', data.officialUrl)
    formDataToSend.append('isDuplicate', String(data.isDuplicate))

    setCreating(true)
    toast('正在发布中 ...')

    const res = await kunFetchFormData<
      KunResponse<{
        uniqueId: string
        patchId: number
      }>
    >('/edit', formDataToSend, 60000)

    if (typeof res === 'string') {
      kunErrorHandler(res, () => {})
      setCreating(false)
      return
    }

    const galleryImages =
      await localforage.getItem<GalleryImage[]>('kun-patch-gallery')
    const watermark = await localforage.getItem<boolean>(
      'kun-patch-gallery-watermark'
    )

    if (galleryImages && galleryImages.length > 0) {
      toast('正在上传游戏截图 ...')
      const { failCount } = await uploadGalleryImages(
        res.patchId,
        galleryImages,
        !!watermark
      )
      if (failCount > 0) {
        toast.error(`${failCount} 张图片上传失败, 您可以稍后在编辑页面重新上传`)
      }
    }

    resetData()
    await localforage.removeItem('kun-patch-banner')
    await localforage.removeItem('kun-patch-banner-original')
    await localforage.removeItem('kun-patch-gallery')
    await localforage.removeItem('kun-patch-gallery-watermark')
    toast.success('发布完成, 正在为您跳转到资源介绍页面')
    router.push(`/${res.uniqueId}`)
    setCreating(false)
  }

  return (
    <Button
      color="primary"
      onPress={handleSubmit}
      className={cn('w-full mt-4', className)}
      isDisabled={creating}
      isLoading={creating}
    >
      提交
    </Button>
  )
}
