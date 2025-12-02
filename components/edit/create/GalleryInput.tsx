'use client'

import { useEffect, useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import localforage from 'localforage'
import { Button, Checkbox, Switch } from '@heroui/react'
import { Upload, Maximize2 } from 'lucide-react'
import { checkImageValid } from '~/utils/resizeImage'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { cn } from '~/utils/cn'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type {
  DragEndEvent,
  DragStartEvent,
  DropAnimation
} from '@dnd-kit/core'

export interface GalleryImage {
  id: string
  blob: Blob
  url: string
  isNSFW: boolean
}

interface SortableItemProps {
  id: string
  img: GalleryImage
  selected: boolean
  onToggle: () => void
  onOpenLightbox: () => void
}

const SortableItem = ({
  id,
  img,
  selected,
  onToggle,
  onOpenLightbox
}: SortableItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 ${img.isNSFW
        ? 'border-danger'
        : selected
          ? 'border-primary'
          : 'border-transparent'
        }`}
      onClick={onToggle}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url}
        alt="gallery"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute bottom-2 left-2 z-10">
        <Checkbox isSelected={selected} className="pointer-events-none" />
      </div>
      <div
        className="absolute bottom-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onOpenLightbox()
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
  )
}

const ItemOverlay = ({
  img,
  selected
}: {
  img: GalleryImage
  selected: boolean
}) => {
  return (
    <div
      className={`group relative aspect-video cursor-grabbing overflow-hidden rounded-lg border-2 ${img.isNSFW
        ? 'border-danger'
        : selected
          ? 'border-primary'
          : 'border-transparent'
        }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.url}
        alt="gallery"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute bottom-2 left-2 z-10">
        <Checkbox isSelected={selected} className="pointer-events-none" />
      </div>
      {img.isNSFW && (
        <div className="absolute right-1 top-1 rounded bg-danger px-1 text-xs text-white">
          NSFW
        </div>
      )}
    </div>
  )
}

export const GalleryInput = () => {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [watermark, setWatermark] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)

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
      } else {
        setWatermark(true)
        await localforage.setItem('kun-patch-gallery-watermark', true)
      }
    }
    loadData()
  }, [])

  const updateImages = (newImages: GalleryImage[]) => {
    setImages(newImages)
    const toStore = newImages.map(({ id, blob, isNSFW }) => ({
      id,
      blob,
      isNSFW,
      url: ''
    }))
    localforage.setItem('kun-patch-gallery', toStore)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = images.findIndex((item) => item.id === active.id)
      const newIndex = images.findIndex((item) => item.id === over.id)

      const newImages = arrayMove(images, oldIndex, newIndex)
      updateImages(newImages)
    }
    setActiveId(null)
  }

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5'
        }
      }
    })
  }

  const handleSetWatermark = async (val: boolean) => {
    setWatermark(val)
    await localforage.setItem('kun-patch-gallery-watermark', val)
  }

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
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
      updateImages([...images, ...newImages])
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

  const deleteSelected = () => {
    const newImages = images.filter((img) => !selectedIds.has(img.id))
    updateImages(newImages)
    setSelectedIds(new Set())
  }

  const setNSFWSelected = (isNSFW: boolean) => {
    const newImages = images.map((img) =>
      selectedIds.has(img.id) ? { ...img, isNSFW } : img
    )
    updateImages(newImages)
    setSelectedIds(new Set())
  }

  const activeItem = activeId ? images.find((img) => img.id === activeId) : null

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

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KunImageViewer
                images={images.map((img) => ({
                  src: img.url,
                  alt: 'gallery'
                }))}
              >
                {(openLightbox) => (
                  <SortableContext
                    items={images.map((i) => i.id)}
                    strategy={rectSortingStrategy}
                  >
                    {images.map((img, index) => (
                      <SortableItem
                        key={img.id}
                        id={img.id}
                        img={img}
                        selected={selectedIds.has(img.id)}
                        onToggle={() => toggleSelection(img.id)}
                        onOpenLightbox={() => openLightbox(index)}
                      />
                    ))}
                  </SortableContext>
                )}
              </KunImageViewer>
            </div>
            <DragOverlay dropAnimation={dropAnimation}>
              {activeItem ? (
                <ItemOverlay
                  img={activeItem}
                  selected={selectedIds.has(activeItem.id)}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  )
}
