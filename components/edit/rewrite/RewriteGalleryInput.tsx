'use client'

import { useCallback, useState, useMemo, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Button, Checkbox, Switch } from '@heroui/react'
import { Upload, Maximize2 } from 'lucide-react'
import { checkImageValid } from '~/utils/resizeImage'
import { useRewritePatchStore } from '~/store/rewriteStore'
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

interface SortableItemProps {
  id: string | number
  img: any
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
      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 ${(img.type === 'old' ? img.is_nsfw : img.isNSFW)
          ? 'border-danger'
          : selected
            ? 'border-primary'
            : 'border-transparent'
        }`}
      onClick={onToggle}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.type === 'old' ? img.url : URL.createObjectURL(img.file)}
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
      {img.type === 'new' && (
        <div className="absolute left-1 top-1 rounded bg-primary px-1 text-xs text-white">
          NEW
        </div>
      )}
      {(img.type === 'old' ? img.is_nsfw : img.isNSFW) && (
        <div className="absolute right-1 top-1 rounded bg-danger px-1 text-xs text-white">
          NSFW
        </div>
      )}
    </div>
  )
}

const ItemOverlay = ({ img, selected }: { img: any; selected: boolean }) => {
  return (
    <div
      className={`group relative aspect-video cursor-grabbing overflow-hidden rounded-lg border-2 ${(img.type === 'old' ? img.is_nsfw : img.isNSFW)
          ? 'border-danger'
          : selected
            ? 'border-primary'
            : 'border-transparent'
        }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.type === 'old' ? img.url : URL.createObjectURL(img.file)}
        alt="gallery"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute bottom-2 left-2 z-10">
        <Checkbox isSelected={selected} className="pointer-events-none" />
      </div>
      {img.type === 'new' && (
        <div className="absolute left-1 top-1 rounded bg-primary px-1 text-xs text-white">
          NEW
        </div>
      )}
      {(img.type === 'old' ? img.is_nsfw : img.isNSFW) && (
        <div className="absolute right-1 top-1 rounded bg-danger px-1 text-xs text-white">
          NSFW
        </div>
      )}
    </div>
  )
}

export const RewriteGalleryInput = () => {
  const {
    data,
    setData,
    newImages,
    setNewImages,
    watermark,
    setWatermark,
    galleryOrder,
    setGalleryOrder
  } = useRewritePatchStore()
  const [selectedExistingIds, setSelectedExistingIds] = useState<Set<number>>(
    new Set()
  )
  const [selectedNewIds, setSelectedNewIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | number | null>(null)

  const items = useMemo(() => {
    const oldMap = new Map(
      data.images.map((img) => [img.id, { ...img, type: 'old' }])
    )
    const newMap = new Map(
      newImages.map((img) => [img.id, { ...img, type: 'new' }])
    )

    const orderedItems: any[] = []
    const seenIds = new Set()

    for (const id of galleryOrder) {
      if (oldMap.has(id as number)) {
        orderedItems.push(oldMap.get(id as number))
        seenIds.add(id)
      } else if (newMap.has(id as string)) {
        orderedItems.push(newMap.get(id as string))
        seenIds.add(id)
      }
    }

    data.images.forEach((img) => {
      if (!seenIds.has(img.id)) {
        orderedItems.push({ ...img, type: 'old' })
      }
    })
    newImages.forEach((img) => {
      if (!seenIds.has(img.id)) {
        orderedItems.push({ ...img, type: 'new' })
      }
    })

    return orderedItems
  }, [data.images, newImages, galleryOrder])

  useEffect(() => {
    const currentIds = items.map((i) => i.id)
    if (items.length !== galleryOrder.length) {
      setGalleryOrder(currentIds)
    }
  }, [items, galleryOrder, setGalleryOrder])

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
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id)
      const newIndex = items.findIndex((item) => item.id === over.id)

      const newItems = arrayMove(items, oldIndex, newIndex)
      setGalleryOrder(newItems.map((i) => i.id))
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
      const remaining = newImages.filter((img) => !selectedNewIds.has(img.id))
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

  const hasSelection = selectedExistingIds.size > 0 || selectedNewIds.size > 0

  const allImages = items.map((img) => ({
    src: img.type === 'old' ? img.url : URL.createObjectURL(img.file),
    alt: 'gallery'
  }))

  const activeItem = activeId
    ? items.find((item) => item.id === activeId)
    : null

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

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KunImageViewer images={allImages}>
                {(openLightbox) => (
                  <SortableContext
                    items={items.map((i) => i.id)}
                    strategy={rectSortingStrategy}
                  >
                    {items.map((img, index) => (
                      <SortableItem
                        key={img.id}
                        id={img.id}
                        img={img}
                        selected={
                          img.type === 'old'
                            ? selectedExistingIds.has(img.id)
                            : selectedNewIds.has(img.id)
                        }
                        onToggle={() =>
                          img.type === 'old'
                            ? toggleExistingSelection(img.id)
                            : toggleNewSelection(img.id)
                        }
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
                  selected={
                    activeItem.type === 'old'
                      ? selectedExistingIds.has(activeItem.id)
                      : selectedNewIds.has(activeItem.id)
                  }
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  )
}
