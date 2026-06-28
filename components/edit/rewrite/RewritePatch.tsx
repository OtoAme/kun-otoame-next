'use client'

import { useState } from 'react'
import { Button, Card, CardBody, CardHeader, Input } from '@heroui/react'
import { useRewritePatchStore } from '~/store/rewriteStore'
import { KunDualEditorProvider } from '~/components/kun/milkdown/DualEditorProvider'
import toast from 'react-hot-toast'
import { kunFetchPutFormData } from '~/utils/kunFetch'
import { kunErrorHandler } from '~/utils/kunErrorHandler'
import { patchUpdateSchema } from '~/validations/edit'
import { useRouter } from '@bprogress/next'
import { GameNameInput } from './GameNameInput'
import { AliasManager } from './AliasManager'
import { ContentLimit } from './ContentLimit'
import { RewriteGalleryInput } from './RewriteGalleryInput'
import { RewriteBanner } from './RewriteBanner'
import { BatchTag } from '../components/BatchTag'
import { BangumiInput } from '../components/BangumiInput'
import { SteamInput } from '../components/SteamInput'
import { ReleaseDateInput } from '../components/ReleaseDateInput'
import { VNDBInput } from '../create/VNDBInput'
import { VNDBRelationInput } from '../create/VNDBRelationInput'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import { uploadGalleryItems } from '../utils/galleryUploadBatch'
// import { DLSiteInput } from '../create/DLSiteInput'
import type {
  RewriteNewGalleryImage,
  RewritePatchData
} from '~/store/rewriteStore'

export const RewritePatch = () => {
  const router = useRouter()
  const { data, setData, newImages, setNewImages, newBanner, setGalleryOrder } =
    useRewritePatchStore()
  const [errors, setErrors] = useState<
    Partial<Record<keyof RewritePatchData, string>>
  >({})
  const hasFailedGalleryUploads = newImages.some(
    (img) => img.uploadStatus === 'failed'
  )

  const addAlias = (newAlias: string) => {
    const alias = newAlias.trim()
    if (data.alias.includes(alias)) {
      toast.error('请不要使用重复的别名')
      return
    }
    if (newAlias.trim()) {
      setData({ ...data, alias: [...data.alias, alias] })
    }
  }

  const [rewriting, setRewriting] = useState(false)

  const updateNewImageStatus = (item: RewriteNewGalleryImage) => {
    const latest = useRewritePatchStore.getState()
    setNewImages(
      latest.newImages.map((image) =>
        image.id === item.id
          ? {
              ...image,
              uploadStatus: item.uploadStatus,
              uploadError: item.uploadError
            }
          : image
      )
    )
  }

  const handleSubmit = async () => {
    const result = patchUpdateSchema.safeParse({
      ...data,
      isDuplicate: String(data.isDuplicate)
    })
    if (!result.success) {
      const newErrors: Partial<Record<keyof RewritePatchData, string>> = {}
      result.error.errors.forEach((err) => {
        if (err.path.length) {
          newErrors[err.path[0] as keyof RewritePatchData] = err.message
          toast.error(err.message)
        }
      })
      setErrors(newErrors)
      return
    } else {
      setErrors({})
    }

    setRewriting(true)

    const formData = new FormData()
    const officialUrl = applySteamOfficialUrlFallback(
      data.officialUrl,
      data.steamId
    )
    formData.append('id', data.id.toString())
    formData.append('name', data.name)
    if (data.vndbId) formData.append('vndbId', data.vndbId)
    if (data.vndbRelationId)
      formData.append('vndbRelationId', data.vndbRelationId)
    if (data.bangumiId) formData.append('bangumiId', data.bangumiId)
    if (data.steamId) formData.append('steamId', data.steamId)
    if (data.dlsiteCode) formData.append('dlsiteCode', data.dlsiteCode)
    formData.append('dlsiteCircleName', data.dlsiteCircleName)
    formData.append('dlsiteCircleLink', data.dlsiteCircleLink)
    formData.append('introduction', data.introduction)
    formData.append('contentLimit', data.contentLimit)
    if (data.released) formData.append('released', data.released)
    if (officialUrl) formData.append('officialUrl', officialUrl)
    formData.append('isDuplicate', String(data.isDuplicate))

    data.alias.forEach((a) => formData.append('alias', a))
    data.tag.forEach((t) => formData.append('tag', t))
    data.vndbDevelopers.forEach((developer) =>
      formData.append('vndbDevelopers', developer)
    )
    data.bangumiTags.forEach((tag) => formData.append('bangumiTags', tag))
    data.bangumiDevelopers.forEach((developer) =>
      formData.append('bangumiDevelopers', developer)
    )
    data.steamTags.forEach((tag) => formData.append('steamTags', tag))
    data.steamDevelopers.forEach((developer) =>
      formData.append('steamDevelopers', developer)
    )
    data.steamAliases.forEach((alias) => formData.append('steamAliases', alias))

    const { watermark, galleryOrder } = useRewritePatchStore.getState()

    const galleryMetadata = {
      keep: data.images.map((img) => ({ id: img.id, is_nsfw: img.is_nsfw })),
      order: galleryOrder
    }
    formData.append('galleryMetadata', JSON.stringify(galleryMetadata))

    if (newBanner) {
      formData.append('banner', newBanner)
    }

    const res = await kunFetchPutFormData<KunResponse<{}>>(
      '/edit',
      formData,
      60000
    )

    let updateSuccess = false
    kunErrorHandler(res, () => {
      updateSuccess = true
    })

    if (!updateSuccess) {
      setRewriting(false)
      return
    }

    if (newImages.length > 0) {
      toast('正在上传游戏截图 ...')
      const queueItems = [...newImages]
      const { uploaded, failed } = await uploadGalleryItems({
        patchId: data.id,
        items: queueItems,
        watermark,
        getDisplayOrder: (img, index) => {
          const order = galleryOrder.indexOf(img.id)
          return order >= 0 ? order : index
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
          updateNewImageStatus(item)
        }
      })

      if (failed.length > 0) {
        const latest = useRewritePatchStore.getState()
        const uploadedIdMap = new Map(
          uploaded.map((img) => [img.oldId, img.imageId])
        )
        setData({
          ...latest.data,
          images: [
            ...latest.data.images,
            ...uploaded.map((img) => ({
              id: img.imageId,
              url: img.url,
              thumbnail_url: img.thumbnailUrl,
              is_nsfw: img.isNSFW
            }))
          ]
        })
        setNewImages(failed)
        setGalleryOrder(
          latest.galleryOrder.map((id) =>
            typeof id === 'string' ? (uploadedIdMap.get(id) ?? id) : id
          )
        )
        toast.error(`${failed.length} 张图片上传失败，请重试后再离开页面`, {
          duration: 8000
        })
        setRewriting(false)
        return
      }
    }

    toast.success('重新编辑成功, 由于缓存影响, 您的更改将在至多 30 秒后生效')
    router.push(`/${data.uniqueId}`)
    setRewriting(false)
  }

  return (
    <form className="flex-1 w-full p-4 mx-auto">
      <Card className="w-full">
        <CardHeader className="flex gap-3">
          <div className="flex flex-col">
            <p className="text-2xl">编辑游戏信息</p>
          </div>
        </CardHeader>
        <CardBody className="mt-4 space-y-12">
          <VNDBInput
            data={data}
            setData={setData}
            errors={errors.vndbId}
            isDuplicate={data.isDuplicate}
            excludeId={data.id}
            onDuplicateChange={(value) =>
              setData({ ...data, isDuplicate: value })
            }
          />
          <VNDBRelationInput
            data={data}
            setData={setData}
            errors={errors.vndbRelationId}
            enableDuplicateCheck={false}
            excludeId={data.id}
          />
          <BangumiInput
            data={data}
            setData={setData}
            errors={errors.bangumiId}
            excludeId={data.id}
          />
          <SteamInput
            data={data}
            setData={setData}
            errors={errors.steamId}
            excludeId={data.id}
          />
          <GameNameInput
            name={data.name}
            onChange={(name) => setData({ ...data, name })}
            error={errors.name}
          />

          <RewriteBanner />

          <div className="space-y-2">
            <h2 className="text-xl">游戏介绍 (可选)</h2>
            {errors.introduction && (
              <p className="text-xs text-danger-500">{errors.introduction}</p>
            )}
            <KunDualEditorProvider storeName="patchRewrite" />
          </div>

          <RewriteGalleryInput />

          <AliasManager
            aliasList={data.alias}
            onAddAlias={addAlias}
            onRemoveAlias={(index) =>
              setData({
                ...data,
                alias: data.alias.filter((_, i) => i !== index)
              })
            }
            onReorderAlias={(nextAlias) =>
              setData({
                ...data,
                alias: nextAlias
              })
            }
            errors={errors.alias}
          />

          <div className="space-y-2">
            <h2 className="text-xl">官方链接 (可选)</h2>
            <Input
              placeholder="输入 Steam 商店链接或官方网站链接"
              value={applySteamOfficialUrlFallback(
                data.officialUrl,
                data.steamId
              )}
              onChange={(e) =>
                setData({ ...data, officialUrl: e.target.value })
              }
              isInvalid={!!errors.officialUrl}
              errorMessage={errors.officialUrl}
            />
          </div>

          <ReleaseDateInput
            date={data.released}
            setDate={(date) => {
              setData({ ...data, released: date })
            }}
            errors={errors.released}
          />

          <BatchTag
            data={data}
            saveTag={(tag) =>
              setData({
                ...data,
                tag
              })
            }
            errors={errors.tag}
          />

          <ContentLimit errors={errors.contentLimit} />

          <Button
            color="primary"
            className="w-full mt-4"
            onPress={handleSubmit}
            isLoading={rewriting}
            isDisabled={rewriting}
          >
            {hasFailedGalleryUploads ? '重试失败截图并提交' : '提交'}
          </Button>
        </CardBody>
      </Card>
    </form>
  )
}
