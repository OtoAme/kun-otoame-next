'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  Progress,
  Spinner,
  Switch
} from '@heroui/react'
import { Maximize2, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { checkImageValid } from '~/utils/resizeImage'
import { generateUUID } from '~/utils/random'
import { kunFetchFormData, kunFetchPatch } from '~/utils/kunFetch'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { NSFWMask } from '~/components/kun/NSFWMask'
import { getGalleryFilesFromEvent } from '~/utils/galleryDrop'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import { PATCH_SUBMISSION_GALLERY_MAX_COUNT } from '~/constants/patchSubmission'
import {
  loadPatchSubmissionUploadDraft,
  savePatchSubmissionUploadDraft,
  type PatchSubmissionLocalUpload
} from '~/utils/patchSubmissionUploadDraft'
import { cn } from '~/utils/cn'
import type { PatchSubmissionGalleryImage } from '~/types/api/patchSubmission'

interface LocalUploadView extends PatchSubmissionLocalUpload {
  previewUrl: string
}

interface ServerCardProps {
  image: PatchSubmissionGalleryImage
  index: number
  selected: boolean
  editable: boolean
  onToggle: () => void
  onOpenLightbox: () => void
  onDelete: () => void
}

const SubmissionGalleryCard = ({
  image,
  index,
  selected,
  editable,
  onToggle,
  onOpenLightbox,
  onDelete
}: ServerCardProps) => {
  const label = `第 ${index + 1} 张截图`
  const [revealed, setRevealed] = useState(!image.isNSFW)

  useEffect(() => {
    setRevealed(!image.isNSFW)
  }, [image.id, image.isNSFW])

  return (
    <Card
      className={cn(
        'relative',
        selected && 'ring-2 ring-primary',
        image.isNSFW && 'border-2 border-danger'
      )}
    >
      <CardBody className="space-y-2 p-2">
        {image.thumbnailUrl || image.imageUrl ? (
          <div className="relative aspect-video overflow-hidden rounded-medium">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.thumbnailUrl ?? image.imageUrl ?? ''}
              alt={label}
              className="size-full object-cover"
            />
            <NSFWMask
              isVisible={!revealed}
              onReveal={() => setRevealed(true)}
            />
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-medium bg-default-100 text-sm text-default-500">
            {image.uploadStatus === 'failed' ? '上传失败占位' : '上传中'}
          </div>
        )}

        <div className="flex items-center justify-between gap-1">
          <Checkbox
            size="sm"
            isDisabled={!editable || image.uploadStatus !== 'ready'}
            isSelected={selected}
            onValueChange={onToggle}
            aria-label={`选择${label}`}
          >
            <span className="text-tiny">选择</span>
          </Checkbox>

          <div className="flex gap-1">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              isDisabled={!revealed || !image.imageUrl}
              onPress={onOpenLightbox}
              aria-label={`放大查看${label}`}
            >
              <Maximize2 className="size-4" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              isDisabled={!editable}
              onPress={onDelete}
              aria-label={`删除${label}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {image.uploadStatus === 'failed' && (
          <Chip size="sm" color="danger" variant="flat">
            上传失败，请重新选择
          </Chip>
        )}
      </CardBody>
    </Card>
  )
}

const LocalUploadCard = ({
  item,
  editable,
  batchRunning,
  onRetry,
  onRemove
}: {
  item: LocalUploadView
  editable: boolean
  batchRunning: boolean
  onRetry: () => void
  onRemove: () => void
}) => (
  <Card className={item.status === 'failed' ? 'border border-danger' : ''}>
    <CardBody className="space-y-2 p-2">
      <div className="relative aspect-video overflow-hidden rounded-medium">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt={item.fileName}
          className="size-full object-cover"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 p-3 text-center text-white">
          {item.status === 'uploading' ? (
            <>
              <Spinner color="white" size="sm" />
              <span className="text-xs">正在上传</span>
            </>
          ) : item.status === 'failed' ? (
            <span className="line-clamp-3 text-xs">
              {item.error || '上传失败，请重试'}
            </span>
          ) : (
            <span className="text-xs">等待上传</span>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-1">
        <Button
          isIconOnly
          size="sm"
          variant="light"
          aria-label={`重试上传 ${item.fileName}`}
          isDisabled={!editable || batchRunning || item.status === 'uploading'}
          onPress={onRetry}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button
          isIconOnly
          size="sm"
          color="danger"
          variant="light"
          aria-label={`移除待上传图片 ${item.fileName}`}
          isDisabled={!editable || batchRunning || item.status === 'uploading'}
          onPress={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </CardBody>
  </Card>
)

const toPersistedItems = (items: LocalUploadView[]) =>
  items.map(({ previewUrl: _previewUrl, ...item }) => item)

export const SubmissionGalleryInput = () => {
  const { submissionId, gallery, setGallery, status, setAssetDraftState } =
    usePatchSubmissionStore()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [localUploads, setLocalUploads] = useState<LocalUploadView[]>([])
  const [watermark, setWatermark] = useState(false)
  const [updatingNSFW, setUpdatingNSFW] = useState(false)
  const [progress, setProgress] = useState<{
    total: number
    completed: number
  } | null>(null)
  const localUploadsRef = useRef<LocalUploadView[]>([])
  const previewUrls = useRef(new Map<string, string>())
  const batchRunning = useRef(false)
  const mounted = useRef(true)
  const editable = status === 'draft' || status === 'changes_requested'
  const isBatchRunning = localUploads.some(
    (item) => item.status === 'uploading'
  )

  const updateLocalState = useCallback(
    (items: LocalUploadView[], loaded = true) => {
      localUploadsRef.current = items
      if (mounted.current) {
        setLocalUploads(items)
        setAssetDraftState({ localCount: items.length, loaded })
      }
    },
    [setAssetDraftState]
  )

  const persistLocalState = useCallback(
    async (items: LocalUploadView[]) => {
      await savePatchSubmissionUploadDraft(
        submissionId,
        toPersistedItems(items)
      )
      updateLocalState(items)
    },
    [submissionId, updateLocalState]
  )

  const releasePreview = useCallback((clientAssetId: string) => {
    const url = previewUrls.current.get(clientAssetId)
    if (url) URL.revokeObjectURL(url)
    previewUrls.current.delete(clientAssetId)
  }, [])

  useEffect(() => {
    mounted.current = true
    setSelected(new Set())
    setAssetDraftState({ localCount: 0, uploadsInFlight: 0, loaded: false })
    let cancelled = false

    const restore = async () => {
      try {
        const stored = await loadPatchSubmissionUploadDraft(submissionId)
        if (cancelled) return
        const valid = stored.filter((item) => item.blob instanceof Blob)
        const views = valid.map((item) => {
          const previewUrl = URL.createObjectURL(item.blob)
          previewUrls.current.set(item.clientAssetId, previewUrl)
          return { ...item, previewUrl }
        })
        await savePatchSubmissionUploadDraft(submissionId, valid)
        updateLocalState(views)
      } catch (error) {
        console.error('Failed to restore submission upload draft', error)
        if (!cancelled) {
          setAssetDraftState({ localCount: 0, loaded: false })
          toast.error('读取待上传截图失败，请刷新后重试')
        }
      }
    }
    void restore()

    return () => {
      cancelled = true
      mounted.current = false
      for (const url of previewUrls.current.values()) {
        URL.revokeObjectURL(url)
      }
      previewUrls.current.clear()
    }
  }, [setAssetDraftState, submissionId, updateLocalState])

  const uploadItems = useCallback(
    async (clientAssetIds: string[]) => {
      if (batchRunning.current || !clientAssetIds.length) return
      batchRunning.current = true
      if (mounted.current) {
        setProgress({ total: clientAssetIds.length, completed: 0 })
        setAssetDraftState({ uploadsInFlight: 1 })
      }

      let completed = 0
      for (const clientAssetId of clientAssetIds) {
        let current = localUploadsRef.current
        const target = current.find(
          (item) => item.clientAssetId === clientAssetId
        )
        if (!target) {
          completed += 1
          if (mounted.current) {
            setProgress({ total: clientAssetIds.length, completed })
          }
          continue
        }

        const uploading = current.map((item) =>
          item.clientAssetId === clientAssetId
            ? { ...item, status: 'uploading' as const, error: null }
            : item
        )
        try {
          await persistLocalState(uploading)
          const formData = new FormData()
          formData.set('submissionId', String(submissionId))
          formData.set('clientAssetId', target.clientAssetId)
          formData.set(
            'image',
            new File([target.blob], target.fileName, {
              type: target.mimeType,
              lastModified: target.lastModified
            })
          )
          formData.set('displayOrder', String(target.displayOrder))
          formData.set('isNSFW', String(target.isNSFW))
          formData.set('watermark', String(target.watermark))

          const response = await kunFetchFormData<
            | string
            | {
                galleryId: number
                alreadyUploaded: boolean
                gallery: PatchSubmissionGalleryImage
              }
          >('/patch-submission/asset', formData)
          if (typeof response === 'string') throw new Error(response)

          current = localUploadsRef.current.filter(
            (item) => item.clientAssetId !== clientAssetId
          )
          await persistLocalState(current)
          releasePreview(clientAssetId)

          if (
            mounted.current &&
            usePatchSubmissionStore.getState().submissionId === submissionId
          ) {
            const latest = usePatchSubmissionStore.getState().gallery
            setGallery(
              [
                ...latest.filter(
                  (image) =>
                    image.id !== response.gallery.id &&
                    image.clientAssetId !== response.gallery.clientAssetId
                ),
                response.gallery
              ].sort((left, right) => left.displayOrder - right.displayOrder)
            )
          }
        } catch (error) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : '上传失败，请重试'
          current = localUploadsRef.current.map((item) =>
            item.clientAssetId === clientAssetId
              ? { ...item, status: 'failed' as const, error: message }
              : item
          )
          try {
            await persistLocalState(current)
          } catch (persistError) {
            console.error('Failed to persist submission upload failure', {
              persistError
            })
          }
          toast.error(message)
        } finally {
          completed += 1
          if (mounted.current) {
            setProgress({ total: clientAssetIds.length, completed })
          }
        }
      }

      batchRunning.current = false
      if (mounted.current) setAssetDraftState({ uploadsInFlight: 0 })
    },
    [
      persistLocalState,
      releasePreview,
      setAssetDraftState,
      setGallery,
      submissionId
    ]
  )

  const localIds = new Set(localUploads.map((item) => item.clientAssetId))
  const visibleGallery = gallery.filter(
    (image) =>
      !(image.uploadStatus !== 'ready' && localIds.has(image.clientAssetId))
  )
  const serverSlotCount = gallery.filter(
    (image) =>
      image.uploadStatus !== 'failed' && !localIds.has(image.clientAssetId)
  ).length
  const totalSlotCount = serverSlotCount + localUploads.length

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    getFilesFromEvent: getGalleryFilesFromEvent,
    accept: { 'image/*': [] },
    disabled: !editable || isBatchRunning,
    onDrop: async (accepted: File[]) => {
      if (batchRunning.current) {
        toast.error('请等待当前截图上传完成')
        return
      }
      const valid = accepted.filter((file) => checkImageValid(file))
      if (!valid.length) return
      if (totalSlotCount + valid.length > PATCH_SUBMISSION_GALLERY_MAX_COUNT) {
        toast.error(`截图最多 ${PATCH_SUBMISSION_GALLERY_MAX_COUNT} 张`)
        return
      }

      const nextItems = valid.map((file, offset) => {
        const clientAssetId = generateUUID().replace(/-/g, '')
        const previewUrl = URL.createObjectURL(file)
        previewUrls.current.set(clientAssetId, previewUrl)
        return {
          clientAssetId,
          blob: file,
          fileName: file.name,
          mimeType: file.type,
          lastModified: file.lastModified,
          displayOrder: totalSlotCount + offset,
          isNSFW: false,
          watermark,
          status: 'pending' as const,
          error: null,
          previewUrl
        }
      })
      const next = [...localUploadsRef.current, ...nextItems]
      try {
        await persistLocalState(next)
        void uploadItems(nextItems.map((item) => item.clientAssetId))
      } catch (error) {
        console.error('Failed to persist submission upload draft', error)
        for (const item of nextItems) releasePreview(item.clientAssetId)
        toast.error('保存待上传截图失败，未开始上传')
      }
    }
  })

  const removeLocalUpload = async (clientAssetId: string) => {
    const next = localUploadsRef.current.filter(
      (item) => item.clientAssetId !== clientAssetId
    )
    try {
      await persistLocalState(next)
      releasePreview(clientAssetId)
    } catch (error) {
      console.error('Failed to remove submission upload draft item', error)
      toast.error('移除待上传截图失败，请重试')
    }
  }

  const deleteImage = async (galleryId: number) => {
    const response = await fetch('/api/patch-submission/asset', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'kun-fetch'
      },
      body: JSON.stringify({ submissionId, galleryId })
    })
    const data = (await response.json()) as string | Record<string, never>
    if (typeof data === 'string') {
      toast.error(data)
      return
    }
    setGallery(
      usePatchSubmissionStore
        .getState()
        .gallery.filter((image) => image.id !== galleryId)
    )
  }

  const setSelectedNSFW = async (isNSFW: boolean) => {
    const galleryIds = [...selected]
    if (!galleryIds.length) return
    setUpdatingNSFW(true)
    try {
      const response = await kunFetchPatch<string | Record<string, never>>(
        '/patch-submission/asset',
        { submissionId, galleryIds, isNSFW }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      setGallery(
        usePatchSubmissionStore
          .getState()
          .gallery.map((image) =>
            selected.has(image.id) ? { ...image, isNSFW } : image
          )
      )
      setSelected(new Set())
    } catch (error) {
      console.error('Failed to update submission gallery NSFW state', error)
      toast.error('截图分级更新失败，请检查网络后重试')
    } finally {
      setUpdatingNSFW(false)
    }
  }

  const viewerImages = visibleGallery
    .filter((image) => image.imageUrl)
    .map((image, index) => ({
      src: image.imageUrl as string,
      previewSrc: image.thumbnailUrl ?? undefined,
      alt: `第 ${index + 1} 张截图`
    }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">游戏截图 (可选)</h2>
        <div className="flex flex-wrap items-center gap-3">
          {editable && (
            <Switch isSelected={watermark} onValueChange={setWatermark}>
              添加水印
            </Switch>
          )}
          <span className="text-sm text-default-500">
            {totalSlotCount} / {PATCH_SUBMISSION_GALLERY_MAX_COUNT}
          </span>
        </div>
      </div>
      <p className="text-sm text-default-500">
        动态 WebP / AVIF 会保留原始动图，不添加水印。
      </p>

      {progress && (
        <Progress
          aria-label="截图上传进度"
          label="截图上传进度"
          value={progress.completed}
          minValue={0}
          maxValue={progress.total}
          valueLabel={`${progress.completed} / ${progress.total}`}
          showValueLabel
          color={progress.completed === progress.total ? 'success' : 'primary'}
        />
      )}

      {editable && (
        <div
          {...getRootProps()}
          className={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors',
            isBatchRunning
              ? 'cursor-not-allowed opacity-60'
              : isDragActive
                ? 'border-primary bg-primary/10'
                : 'border-default-300 hover:border-primary'
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center justify-center">
            <Upload className="mb-2 size-8 text-default-400" />
            <p className="mb-1">拖放图片到此处或</p>
            <span className="inline-flex items-center rounded-medium bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
              选择文件
            </span>
          </div>
        </div>
      )}

      {(visibleGallery.length > 0 || localUploads.length > 0) && (
        <div className="space-y-3">
          {editable && selected.size > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                color="danger"
                variant="flat"
                isLoading={updatingNSFW}
                onPress={() => void setSelectedNSFW(true)}
              >
                设为 NSFW
              </Button>
              <Button
                size="sm"
                variant="flat"
                isDisabled={updatingNSFW}
                onPress={() => void setSelectedNSFW(false)}
              >
                设为 SFW
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KunImageViewer images={viewerImages}>
              {(openLightbox) => (
                <>
                  {visibleGallery.map((image, index) => {
                    const viewerIndex = visibleGallery
                      .filter((candidate) => candidate.imageUrl)
                      .findIndex((candidate) => candidate.id === image.id)
                    return (
                      <SubmissionGalleryCard
                        key={image.id}
                        image={image}
                        index={index}
                        selected={selected.has(image.id)}
                        editable={editable}
                        onToggle={() =>
                          setSelected((current) => {
                            const next = new Set(current)
                            if (next.has(image.id)) next.delete(image.id)
                            else next.add(image.id)
                            return next
                          })
                        }
                        onOpenLightbox={() =>
                          viewerIndex >= 0 && openLightbox(viewerIndex)
                        }
                        onDelete={() => void deleteImage(image.id)}
                      />
                    )
                  })}
                  {localUploads.map((item) => (
                    <LocalUploadCard
                      key={item.clientAssetId}
                      item={item}
                      editable={editable}
                      batchRunning={isBatchRunning}
                      onRetry={() => void uploadItems([item.clientAssetId])}
                      onRemove={() =>
                        void removeLocalUpload(item.clientAssetId)
                      }
                    />
                  ))}
                </>
              )}
            </KunImageViewer>
          </div>
        </div>
      )}
    </div>
  )
}
