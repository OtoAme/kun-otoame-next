'use client'

import { useEffect, useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import localforage from 'localforage'
import { Button, Checkbox, Switch } from '@heroui/react'
import { Upload, Maximize2 } from 'lucide-react'
import { checkImageValid } from '~/utils/resizeImage'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'

import { cn } from '~/utils/cn'

export interface GalleryImage {
  id: string
  blob: Blob
  url: string
  isNSFW: boolean
}

export const GalleryInput = () => {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [watermark, setWatermark] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      const storedImages = await localforage.getItem<GalleryImage[]>(
        'kun-patch-gallery'
      )
      if (storedImages) {
        const withUrls = storedImages.map((img) => ({
          ...img,
          url: URL.createObjectURL(img.blob)
        }))
        setImages(withUrls)
      }

      const storedWatermark = await localforage.getItem<boolean>(
        'kun-patch-gallery-watermark'
      )
      if (storedWatermark !== null) {
        setWatermark(storedWatermark)
      }
    }
    loadData()
  }, [])

  const saveImages = async (newImages: GalleryImage[]) => {
    const toStore = newImages.map(({ id, blob, isNSFW }) => ({
      id,
      blob,
      isNSFW,
      url: ''
    }))
    await localforage.setItem('kun-patch-gallery', toStore)
    setImages(newImages)
  }

  const handleSetWatermark = async (val: boolean) => {
    setWatermark(val)
    await localforage.setItem('kun-patch-gallery-watermark', val)
  }

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const newImages: GalleryImage[] = []
      for (const file of acceptedFiles) {
        if (!checkImageValid(file)) continue
        const id = crypto.randomUUID()
        newImages.push({
          id,
          blob: file,
          url: URL.createObjectURL(file),
          isNSFW: false
        })
      }
      await saveImages([...images, ...newImages])
    },
    [images]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] }
  })

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const deleteSelected = async () => {
    const newImages = images.filter((img) => !selectedIds.has(img.id))
    await saveImages(newImages)
    setSelectedIds(new Set())
  }

  const setNSFWSelected = async (isNSFW: boolean) => {
    const newImages = images.map((img) =>
      selectedIds.has(img.id) ? { ...img, isNSFW } : img
    )
    await saveImages(newImages)
    setSelectedIds(new Set())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl">游戏画廊 (可选)</h2>
        <div className="flex items-center gap-4">
          <Switch isSelected={watermark} onValueChange={handleSetWatermark}>
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

      {images.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              color="danger"
              variant="flat"
              onPress={deleteSelected}
              isDisabled={selectedIds.size === 0}
            >
              删除选中 ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              color="warning"
              variant="flat"
              onPress={() => setNSFWSelected(true)}
              isDisabled={selectedIds.size === 0}
            >
              设为 NSFW
            </Button>
            <Button
              size="sm"
              color="success"
              variant="flat"
              onPress={() => setNSFWSelected(false)}
              isDisabled={selectedIds.size === 0}
            >
              设为 SFW
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KunImageViewer
              images={images.map((img) => ({ src: img.url, alt: 'gallery' }))}
            >
              {(openLightbox) => (
                <>
                  {images.map((img, index) => (
                    <div
                      key={img.id}
                      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 ${img.isNSFW ? 'border-danger' : selectedIds.has(img.id) ? 'border-primary' : 'border-transparent'}`}
                      onClick={() => toggleSelection(img.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt="gallery"
                        className="h-full w-full object-cover"
                      />

                      <div className="absolute bottom-2 left-2 z-10">
                        <Checkbox
                          isSelected={selectedIds.has(img.id)}
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
