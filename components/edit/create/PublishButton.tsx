'use client'

import { useState } from 'react'
import { Button } from '@heroui/react'
import localforage from 'localforage'
import { useCreatePatchStore } from '~/store/editStore'
import toast from 'react-hot-toast'
import { kunFetchFormData } from '~/utils/kunFetch'
import { kunErrorHandler } from '~/utils/kunErrorHandler'
import {
  clearCreateGalleryDraft,
  CREATE_GALLERY_WATERMARK_KEY,
  getCreateGalleryDraft
} from '~/utils/createGalleryDraft'
import { patchCreateSchema } from '~/validations/edit'
import { useRouter } from '@bprogress/next'
import { cn } from '~/utils/cn'
import type { Dispatch, SetStateAction } from 'react'
import type { CreatePatchRequestData } from '~/store/editStore'
import type { GalleryImage } from './GalleryInput'

const GALLERY_UPLOAD_TIMEOUT_MS = 120000

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
    toast(`正在上传图片 ${index + 1}/${galleryImages.length}`, {
      id: 'gallery-progress'
    })

    const formData = new FormData()
    formData.append('patchId', patchId.toString())
    formData.append('image', img.blob)
    formData.append('isNSFW', String(img.isNSFW))
    formData.append('watermark', String(watermark))
    formData.append('displayOrder', index.toString())

    try {
      const res = await kunFetchFormData<
        KunResponse<{ imageId: number; url: string }>
      >('/edit/gallery', formData, GALLERY_UPLOAD_TIMEOUT_MS)
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
      vndbTags: JSON.stringify(data.vndbTags),
      vndbDevelopers: JSON.stringify(data.vndbDevelopers),
      bangumiTags: JSON.stringify(data.bangumiTags),
      bangumiDevelopers: JSON.stringify(data.bangumiDevelopers),
      steamTags: JSON.stringify(data.steamTags),
      steamDevelopers: JSON.stringify(data.steamDevelopers),
      steamAliases: JSON.stringify(data.steamAliases),
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
    formDataToSend.append('bangumiId', data.bangumiId)
    formDataToSend.append('steamId', data.steamId)
    formDataToSend.append('dlsiteCode', data.dlsiteCode ?? '')
    formDataToSend.append('dlsiteCircleName', data.dlsiteCircleName)
    formDataToSend.append('dlsiteCircleLink', data.dlsiteCircleLink)
    formDataToSend.append('vndbTags', JSON.stringify(data.vndbTags))
    formDataToSend.append('vndbDevelopers', JSON.stringify(data.vndbDevelopers))
    formDataToSend.append('bangumiTags', JSON.stringify(data.bangumiTags))
    formDataToSend.append(
      'bangumiDevelopers',
      JSON.stringify(data.bangumiDevelopers)
    )
    formDataToSend.append('steamTags', JSON.stringify(data.steamTags))
    formDataToSend.append(
      'steamDevelopers',
      JSON.stringify(data.steamDevelopers)
    )
    formDataToSend.append('steamAliases', JSON.stringify(data.steamAliases))
    formDataToSend.append('introduction', data.introduction)
    formDataToSend.append('alias', JSON.stringify(data.alias))
    formDataToSend.append('tag', JSON.stringify(data.tag))
    formDataToSend.append('released', data.released)
    formDataToSend.append('contentLimit', data.contentLimit)
    if (data.officialUrl) formDataToSend.append('officialUrl', data.officialUrl)
    formDataToSend.append('isDuplicate', String(data.isDuplicate))

    setCreating(true)
    toast('正在发布中 ...')

    const galleryImages = await getCreateGalleryDraft()
    const watermark = await localforage.getItem<boolean>(
      CREATE_GALLERY_WATERMARK_KEY
    )

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

    let hasGalleryUploadFailures = false
    if (galleryImages && galleryImages.length > 0) {
      toast('正在上传游戏截图 ...')
      const { failCount } = await uploadGalleryImages(
        res.patchId,
        galleryImages,
        !!watermark
      )
      if (failCount > 0) {
        hasGalleryUploadFailures = true
        toast.error(`${failCount} 张图片上传失败，请稍后在编辑页面重新上传`, {
          duration: 8000
        })
      }
    }

    resetData()
    await localforage.removeItem('kun-patch-banner')
    await localforage.removeItem('kun-patch-banner-original')
    await clearCreateGalleryDraft()
    await localforage.removeItem(CREATE_GALLERY_WATERMARK_KEY)
    toast.success(
      hasGalleryUploadFailures
        ? '发布完成，但有部分截图上传失败'
        : '发布完成, 正在为您跳转到资源介绍页面'
    )
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
