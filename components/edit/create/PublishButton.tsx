'use client'

import { useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import Link from 'next/link'
import localforage from 'localforage'
import { useCreatePatchStore } from '~/store/editStore'
import toast from 'react-hot-toast'
import { kunFetchFormData } from '~/utils/kunFetch'
import { kunErrorHandler } from '~/utils/kunErrorHandler'
import {
  CREATE_GALLERY_WATERMARK_KEY,
  getCreateGalleryCreatedPatch,
  getCreateGalleryDraft,
  getCreateGalleryRetryItems,
  retainCreateGalleryUploadState,
  saveCreateGalleryCreatedPatch
} from '~/utils/createGalleryDraft'
import {
  CREATE_PATCH_BANNER_KEY,
  CREATE_PATCH_ORIGINAL_BANNER_KEY,
  clearCreatePatchDraftFiles
} from '~/utils/createPatchDraft'
import { patchCreateSchema } from '~/validations/edit'
import { useRouter } from '@bprogress/next'
import { cn } from '~/utils/cn'
import { CREATE_PATCH_PUBLISH_TIMEOUT_MS } from '~/constants/galgame'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import {
  uploadGalleryItems,
  type GalleryUploadQueueItem
} from '../utils/galleryUploadBatch'
import type { Dispatch, SetStateAction } from 'react'
import type { CreatePatchRequestData } from '~/store/editStore'
import type { GalleryImage } from './GalleryInput'

interface Props {
  setErrors: Dispatch<
    SetStateAction<Partial<Record<keyof CreatePatchRequestData, string>>>
  >
  className?: string
}

export const PublishButton = ({ setErrors, className }: Props) => {
  const router = useRouter()
  const { data, resetData } = useCreatePatchStore()

  const [creating, setCreating] = useState(false)
  const [createdPatch, setCreatedPatch] = useState<{
    uniqueId: string
    patchId: number
  } | null>(null)

  useEffect(() => {
    let ignore = false

    getCreateGalleryCreatedPatch()
      .then((patch) => {
        if (!ignore && patch) setCreatedPatch(patch)
      })
      .catch((error) => {
        console.error('Failed to load created patch draft:', error)
      })

    return () => {
      ignore = true
    }
  }, [])

  const handleSubmit = async () => {
    const persistedPatch = await getCreateGalleryCreatedPatch()
    let publishedPatch = createdPatch ?? persistedPatch
    let createFormData: FormData | null = null

    if (!createdPatch && persistedPatch) {
      setCreatedPatch(persistedPatch)
    }

    if (!publishedPatch) {
      const localeBannerBlob: Blob | null = await localforage.getItem(
        CREATE_PATCH_BANNER_KEY
      )
      const localeOriginalBannerBlob: Blob | null = await localforage.getItem(
        CREATE_PATCH_ORIGINAL_BANNER_KEY
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
        vndbTags: JSON.stringify([]),
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
            newErrors[err.path[0] as keyof CreatePatchRequestData] =
              err.message
            toast.error(err.message)
          }
        })
        setErrors(newErrors)
        return
      } else {
        setErrors({})
      }

      const formDataToSend = new FormData()
      const officialUrl = applySteamOfficialUrlFallback(
        data.officialUrl,
        data.steamId
      )
      formDataToSend.append('banner', localeBannerBlob)
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
      formDataToSend.append('vndbTags', JSON.stringify([]))
      formDataToSend.append(
        'vndbDevelopers',
        JSON.stringify(data.vndbDevelopers)
      )
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
      if (officialUrl) formDataToSend.append('officialUrl', officialUrl)
      formDataToSend.append('isDuplicate', String(data.isDuplicate))
      createFormData = formDataToSend
    } else {
      setErrors({})
    }

    setCreating(true)
    const isRetryingCreatedPatch = !!publishedPatch
    toast(isRetryingCreatedPatch ? '正在重试上传游戏截图 ...' : '正在发布中 ...')

    const galleryImages = await getCreateGalleryDraft()
    const watermark = await localforage.getItem<boolean>(
      CREATE_GALLERY_WATERMARK_KEY
    )

    if (!publishedPatch) {
      const res = await kunFetchFormData<
        KunResponse<{
          uniqueId: string
          patchId: number
        }>
      >('/edit', createFormData!, CREATE_PATCH_PUBLISH_TIMEOUT_MS)

      if (typeof res === 'string') {
        kunErrorHandler(res, () => {})
        setCreating(false)
        return
      }

      publishedPatch = res
      setCreatedPatch(res)
      await saveCreateGalleryCreatedPatch(res)
    }

    if (galleryImages && galleryImages.length > 0) {
      const retryImages = getCreateGalleryRetryItems(
        galleryImages,
        isRetryingCreatedPatch
      )
      if (retryImages.length === 0) {
        resetData()
        await clearCreatePatchDraftFiles()
        toast.success('发布完成, 正在为您跳转到资源介绍页面')
        router.push(`/${publishedPatch.uniqueId}`)
        setCreating(false)
        return
      }

      toast('正在上传游戏截图 ...')
      const queueItems = retryImages.map<GalleryUploadQueueItem>((img) => ({
        id: img.id,
        file: img.blob as File,
        isNSFW: img.isNSFW
      }))
      const { uploaded, failed } = await uploadGalleryItems({
        patchId: publishedPatch.patchId,
        items: queueItems,
        watermark: !!watermark,
        getDisplayOrder: (item, index) => {
          const originalIndex = galleryImages.findIndex(
            (img) => img.id === item.id
          )
          return originalIndex >= 0 ? originalIndex : index
        },
        onItemStatus: (item) => {
          if (item.uploadStatus === 'uploading') {
            const index = queueItems.findIndex((img) => img.id === item.id)
            toast(`正在上传图片 ${index + 1}/${queueItems.length}`, {
              id: 'gallery-progress'
            })
          }
          if (item.uploadStatus === 'failed') {
            console.error(`Gallery image ${item.id} failed:`, item.uploadError)
          }
        }
      })

      if (failed.length > 0) {
        await retainCreateGalleryUploadState(galleryImages, {
          uploadedItems: uploaded,
          failedItems: failed
        })
        toast.error(`${failed.length} 张图片上传失败，请重试后再离开页面`, {
          duration: 8000
        })
        setCreating(false)
        return
      }
    }

    resetData()
    await clearCreatePatchDraftFiles()
    toast.success('发布完成, 正在为您跳转到资源介绍页面')
    router.push(`/${publishedPatch.uniqueId}`)
    setCreating(false)
  }

  return (
    <div className={cn('space-y-3', className)}>
      {createdPatch && (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-700">
          游戏主体已发布，仍有截图未上传。请重试失败截图，或先打开详情页确认已发布内容。
          <div className="mt-2">
            <Button
              as={Link}
              href={`/${createdPatch.uniqueId}`}
              size="sm"
              variant="flat"
              color="warning"
            >
              打开详情页
            </Button>
          </div>
        </div>
      )}
      <Button
        color="primary"
        onPress={handleSubmit}
        className="w-full mt-4"
        isDisabled={creating}
        isLoading={creating}
      >
        {createdPatch ? '重试上传失败截图' : '提交'}
      </Button>
    </div>
  )
}
