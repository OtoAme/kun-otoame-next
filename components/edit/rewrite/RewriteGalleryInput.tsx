'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Button, Checkbox, Switch } from '@heroui/react'
import { Upload, Maximize2 } from 'lucide-react'
import { checkImageValid } from '~/utils/resizeImage'
import { useRewritePatchStore } from '~/store/rewriteStore'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { cn } from '~/utils/cn'

export const RewriteGalleryInput = () => {
  const {
    data,
    setData,
    newImages,
    setNewImages,
    watermark,
    setWatermark
  } = useRewritePatchStore()
  const [selectedExistingIds, setSelectedExistingIds] = useState<Set<number>>(
    new Set()
  )
  const [selectedNewIds, setSelectedNewIds] = useState<Set<string>>(new Set())

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const added: { id: string; file: File; isNSFW: boolean }[] = []
      for (const file of acceptedFiles) {
        if (!checkImageValid(file)) continue
        added.push({
          id: crypto.randomUUID(),
          file,
          isNSFW: false
        })
      }
      setNewImages([...newImages, ...added])
    },
    [newImages, setNewImages]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] }
  })

  const toggleExistingSelection = (id: number) => {
    const newSet = new Set(selectedExistingIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedExistingIds(newSet)
  }

  const toggleNewSelection = (id: string) => {
    const newSet = new Set(selectedNewIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedNewIds(newSet)
  }

  const deleteSelected = () => {
    if (selectedExistingIds.size > 0) {
      const remaining = data.images.filter(
        (img) => !selectedExistingIds.has(img.id)
      )
      setData({ ...data, images: remaining })
      setSelectedExistingIds(new Set())
    }
    if (selectedNewIds.size > 0) {
      const remaining = newImages.filter(
        (img) => !selectedNewIds.has(img.id)
      )
      setNewImages(remaining)
      setSelectedNewIds(new Set())
    }
  }

  const setNSFWSelected = (isNSFW: boolean) => {
    if (selectedExistingIds.size > 0) {
      const updated = data.images.map((img) =>
        selectedExistingIds.has(img.id) ? { ...img, is_nsfw: isNSFW } : img
      )
      setData({ ...data, images: updated })
      setSelectedExistingIds(new Set())
    }
    if (selectedNewIds.size > 0) {
      const updated = newImages.map((img) =>
        selectedNewIds.has(img.id) ? { ...img, isNSFW } : img
      )
      setNewImages(updated)
      setSelectedNewIds(new Set())
    }
  }

  const hasSelection =
    selectedExistingIds.size > 0 || selectedNewIds.size > 0

  const allImages = [
    ...data.images.map((img) => ({ src: img.url, alt: 'gallery' })),
    ...newImages.map((img) => ({
      src: URL.createObjectURL(img.file),
      alt: 'gallery-new'
    }))
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl">游戏画廊 (可选)</h2>
        <div className="flex items-center gap-4">
          <Switch isSelected={watermark} onValueChange={setWatermark}>
            添加水印
          </Switch>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          'mb-4 cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors',
          isDragActive
            ? 'border-primary bg-primary/10'
            : 'border-default-300 hover:border-primary'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center">
          <Upload className="mb-4 h-12 w-12 text-default-400" />
          <p className="mb-2">拖放图片到此处或</p>
          <div className="inline-flex items-center rounded-medium bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20">
            选择文件
          </div>
        </div>
      </div>

      {(data.images.length > 0 || newImages.length > 0) && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              color="danger"
              variant="flat"
              onPress={deleteSelected}
              isDisabled={!hasSelection}
            >
              删除选中 ({selectedExistingIds.size + selectedNewIds.size})
            </Button>
            <Button
              size="sm"
              color="warning"
              variant="flat"
              onPress={() => setNSFWSelected(true)}
              isDisabled={!hasSelection}
            >
              设为 NSFW
            </Button>
            <Button
              size="sm"
              color="success"
              variant="flat"
              onPress={() => setNSFWSelected(false)}
              isDisabled={!hasSelection}
            >
              设为 SFW
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KunImageViewer images={allImages}>
              {(openLightbox) => (
                <>
                  {data.images.map((img, index) => (
                    <div
                      key={img.id}
                      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 ${img.is_nsfw
                        ? 'border-danger'
                        : selectedExistingIds.has(img.id)
                          ? 'border-primary'
                          : 'border-transparent'
                        }`}
                      onClick={() => toggleExistingSelection(img.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt="gallery"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-2 left-2 z-10">
                        <Checkbox
                          isSelected={selectedExistingIds.has(img.id)}
                          className="pointer-events-none"
                        />
                      </div>
                      <div
                        className="absolute bottom-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          openLightbox(index)
                        }}
                      >
                        <div className="rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
                          <Maximize2 className="h-4 w-4" />
                        </div>
                      </div>
                      {img.is_nsfw && (
                        <div className="absolute right-1 top-1 rounded bg-danger px-1 text-xs text-white">
                          NSFW
                        </div>
                      )}
                    </div>
                  ))}

                  {newImages.map((img, index) => (
                    <div
                      key={img.id}
                      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 ${img.isNSFW
                        ? 'border-danger'
                        : selectedNewIds.has(img.id)
                          ? 'border-primary'
                          : 'border-transparent'
                        }`}
                      onClick={() => toggleNewSelection(img.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={URL.createObjectURL(img.file)}
                        alt="gallery-new"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-2 left-2 z-10">
                        <Checkbox
                          isSelected={selectedNewIds.has(img.id)}
                          className="pointer-events-none"
                        />
                      </div>
                      <div
                        className="absolute bottom-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          openLightbox(data.images.length + index)
                        }}
                      >
                        <div className="rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
                          <Maximize2 className="h-4 w-4" />
                        </div>
                      </div>
                      <div className="absolute left-1 top-1 rounded bg-primary px-1 text-xs text-white">
                        NEW
                      </div>
                      {img.isNSFW && (
                        <div className="absolute right-1 top-1 rounded bg-danger px-1 text-xs text-white">
                          NSFW
                        </div>
                      )}
                    </div>
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
