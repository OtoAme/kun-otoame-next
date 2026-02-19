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
import { ReleaseDateInput } from '../components/ReleaseDateInput'
import { VNDBInput } from '../create/VNDBInput'
import { VNDBRelationInput } from '../create/VNDBRelationInput'
import { DLSiteInput } from '../create/DLSiteInput'
import type { RewritePatchData } from '~/store/rewriteStore'

export const RewritePatch = () => {
  const router = useRouter()
  const { data, setData, newImages, newBanner } = useRewritePatchStore()
  const [errors, setErrors] = useState<
    Partial<Record<keyof RewritePatchData, string>>
  >({})

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
    formData.append('id', data.id.toString())
    formData.append('name', data.name)
    if (data.vndbId) formData.append('vndbId', data.vndbId)
    formData.append('introduction', data.introduction)
    formData.append('contentLimit', data.contentLimit)
    if (data.released) formData.append('released', data.released)
    if (data.officialUrl) formData.append('officialUrl', data.officialUrl)
    formData.append('isDuplicate', String(data.isDuplicate))

    data.alias.forEach((a) => formData.append('alias', a))
    data.tag.forEach((t) => formData.append('tag', t))

    const { watermark, galleryOrder } = useRewritePatchStore.getState()

    const galleryMetadata = {
      keep: data.images.map((img) => ({ id: img.id, is_nsfw: img.is_nsfw })),
      new: newImages.map((img) => ({ id: img.id, is_nsfw: img.isNSFW })),
      watermark,
      order: galleryOrder
    }
    formData.append('galleryMetadata', JSON.stringify(galleryMetadata))

    newImages.forEach((img) => {
      formData.append('gallery', img.file)
    })

    if (newBanner) {
      formData.append('banner', newBanner)
    }

    const res = await kunFetchPutFormData<KunResponse<{}>>('/edit', formData, 180000)
    kunErrorHandler(res, async () => {
      router.push(`/${data.uniqueId}`)
    })
    toast.success('重新编辑成功, 由于缓存影响, 您的更改将在至多 30 秒后生效')
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
          <VNDBInput data={data} setData={setData} errors={errors.vndbId} />
          <VNDBRelationInput
            data={data}
            setData={setData}
            errors={errors.vndbRelationId}
            enableDuplicateCheck={false}
          />
          <DLSiteInput
            data={data}
            setData={setData}
            errors={errors.dlsiteCode}
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
            errors={errors.alias}
          />

          <div className="space-y-2">
            <h2 className="text-xl">官方链接 (可选)</h2>
            <Input
              placeholder="输入 Steam 商店链接或官方网站链接"
              value={data.officialUrl}
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
            initialTag={data.tag}
            saveTag={(tag) =>
              setData({
                ...data,
                tag
              })
            }
            errors={errors.tag}
          />

          <BangumiInput
            onTagsFetched={(tags) => {
              setData({ ...data, tag: tags })
            }}
          />

          <ContentLimit errors={errors.contentLimit} />

          <Button
            color="primary"
            className="w-full mt-4"
            onPress={handleSubmit}
            isLoading={rewriting}
            isDisabled={rewriting}
          >
            提交
          </Button>
        </CardBody>
      </Card>
    </form>
  )
}
