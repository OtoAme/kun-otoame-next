'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
import {
  GripVertical,
  Maximize2,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DragEndEvent } from '@dnd-kit/core'
import { checkImageValid } from '~/utils/resizeImage'
import { generateUUID } from '~/utils/random'
import {
  kunFetchDeleteBody,
  kunFetchFormData,
  kunFetchPatch
} from '~/utils/kunFetch'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { getGalleryFilesFromEvent } from '~/utils/galleryDrop'
import { getGalleryUploadFailedOverlayClass } from '~/utils/galleryCardStyle'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import { PATCH_SUBMISSION_GALLERY_MAX_COUNT } from '~/constants/patchSubmission'
import {
  clearPatchSubmissionGalleryOrder,
  loadPatchSubmissionGalleryOrder,
  loadPatchSubmissionUploadDraft,
  loadPatchSubmissionWatermark,
  savePatchSubmissionGalleryOrder,
  savePatchSubmissionUploadDraft,
  savePatchSubmissionWatermark,
  type PatchSubmissionLocalUpload
} from '~/utils/patchSubmissionUploadDraft'
import { cn } from '~/utils/cn'
import type { PatchSubmissionGalleryImage } from '~/types/api/patchSubmission'

interface LocalUploadView extends PatchSubmissionLocalUpload {
  previewUrl: string
}

/** One selection set spans both cloud rows and local pending files, so every
 *  key carries its own namespace. The same keys are what the saved order draft
 *  records, so a sequence survives a refresh across both stores. */
const serverSelectionKey = (galleryId: number) => `server:${galleryId}`
const localSelectionKey = (clientAssetId: string) => `local:${clientAssetId}`

interface GalleryEntry {
  key: string
  image: PatchSubmissionGalleryImage | null
  item: LocalUploadView | null
}

/**
 * The one sequence both stores are read through. While an order draft exists it
 * wins outright, because it is the arrangement the author dragged and the server
 * has not accepted yet; without one the persisted display orders are the truth,
 * which is what lets a freshly uploaded row take over the slot its local card
 * held. Ties keep the cloud rows ahead of local files, so the merge is stable.
 */
const buildOrderedEntries = (
  gallery: PatchSubmissionGalleryImage[],
  localUploads: LocalUploadView[],
  orderKeys: string[] | null
): GalleryEntry[] => {
  const localIds = new Set(localUploads.map((item) => item.clientAssetId))
  const entries: GalleryEntry[] = [
    ...gallery
      .filter(
        (image) =>
          !(image.uploadStatus !== 'ready' && localIds.has(image.clientAssetId))
      )
      .map((image) => ({
        key: serverSelectionKey(image.id),
        image,
        item: null
      })),
    ...localUploads.map((item) => ({
      key: localSelectionKey(item.clientAssetId),
      image: null,
      item
    }))
  ]

  const rank = orderKeys
    ? new Map(orderKeys.map((key, index) => [key, index]))
    : null
  const rankOf = (entry: GalleryEntry) =>
    rank
      ? (rank.get(entry.key) ?? Number.MAX_SAFE_INTEGER)
      : (entry.image?.displayOrder ?? entry.item?.displayOrder ?? 0)

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        rankOf(left.entry) - rankOf(right.entry) || left.index - right.index
    )
    .map(({ entry }) => entry)
}

/**
 * Dragging lives on its own handle rather than on the card. The cards carry
 * focusable select / zoom / delete controls, and letting the whole card start a
 * drag would swallow the pointer and keyboard interaction those need.
 */
const SortableGalleryItem = ({
  id,
  label,
  disabled,
  children
}: {
  id: string
  label: string
  disabled: boolean
  children: ReactNode
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
      className="relative"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`拖动排序${label}`}
        disabled={disabled}
        className="absolute left-3 top-3 z-20 rounded-medium bg-background/80 p-1 text-default-600 shadow-small outline-none transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      {children}
    </div>
  )
}

interface ServerCardProps {
  image: PatchSubmissionGalleryImage
  label: string
  selected: boolean
  editable: boolean
  busy: boolean
  onToggle: () => void
  onOpenLightbox: () => void
  onDelete: () => void
}

const SubmissionGalleryCard = ({
  image,
  label,
  selected,
  editable,
  busy,
  onToggle,
  onOpenLightbox,
  onDelete
}: ServerCardProps) => (
  <Card
    className={cn(
      'relative',
      selected && 'ring-2 ring-primary',
      image.isNSFW && 'border-2 border-danger'
    )}
  >
    <CardBody className="space-y-2 p-2">
      <div className="relative aspect-video overflow-hidden rounded-medium">
        {image.thumbnailUrl || image.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={image.thumbnailUrl ?? image.imageUrl ?? ''}
            alt={label}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-default-100 text-sm text-default-500">
            {image.uploadStatus === 'failed' ? '上传失败占位' : '上传中'}
          </div>
        )}
        {image.uploadStatus === 'failed' && (
          <div className={getGalleryUploadFailedOverlayClass()} />
        )}
        {/* Editing view matches the create/rewrite pages: the author sees
            their own thumbnail with a danger badge, not a reveal mask. The
            read-only preview is where the public NSFWMask belongs. */}
        {image.isNSFW && (
          <div className="absolute right-1 top-1 rounded bg-danger px-1 text-xs text-white">
            NSFW
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-1">
        <Checkbox
          size="sm"
          isDisabled={!editable || busy || image.uploadStatus !== 'ready'}
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
            isDisabled={!image.imageUrl}
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
            isDisabled={!editable || busy}
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

const LocalUploadCard = ({
  item,
  editable,
  selected,
  busy,
  onToggle,
  onRetry,
  onRemove
}: {
  item: LocalUploadView
  editable: boolean
  selected: boolean
  busy: boolean
  onToggle: () => void
  onRetry: () => void
  onRemove: () => void
}) => (
  <Card
    className={cn(
      'relative',
      selected && 'ring-2 ring-primary',
      item.status === 'failed' && 'border border-danger'
    )}
  >
    <CardBody className="space-y-2 p-2">
      <div className="relative aspect-video overflow-hidden rounded-medium">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt={item.fileName}
          className="size-full object-cover"
        />
        {item.status === 'failed' && (
          <div className={getGalleryUploadFailedOverlayClass()} />
        )}
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

      <div className="flex items-center justify-between gap-1">
        <Checkbox
          size="sm"
          isDisabled={!editable || busy || item.status === 'uploading'}
          isSelected={selected}
          onValueChange={onToggle}
          aria-label={`选择待上传图片 ${item.fileName}`}
        >
          <span className="text-tiny">选择</span>
        </Checkbox>

        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label={`重试上传 ${item.fileName}`}
            isDisabled={!editable || busy || item.status === 'uploading'}
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
            isDisabled={!editable || busy || item.status === 'uploading'}
            onPress={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </CardBody>
  </Card>
)

const toPersistedItems = (items: LocalUploadView[]) =>
  items.map(({ previewUrl: _previewUrl, ...item }) => item)

export const SubmissionGalleryInput = () => {
  const { submissionId, gallery, setGallery, status, setAssetDraftState } =
    usePatchSubmissionStore()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [localUploads, setLocalUploads] = useState<LocalUploadView[]>([])
  // Watermark defaults on, matching the create page, so screenshots are marked
  // unless the author opts out.
  const [watermark, setWatermark] = useState(true)
  const [updatingNSFW, setUpdatingNSFW] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderKeys, setOrderKeys] = useState<string[] | null>(null)
  const [progress, setProgress] = useState<{
    total: number
    completed: number
  } | null>(null)
  const localUploadsRef = useRef<LocalUploadView[]>([])
  const orderKeysRef = useRef<string[] | null>(null)
  /** Bumped by every drag, so a save that returns late can tell whether the
   *  sequence it froze is still the one on screen. */
  const orderGeneration = useRef(0)
  const savingOrderRef = useRef(false)
  const previewUrls = useRef(new Map<string, string>())
  const batchRunning = useRef(false)
  const mounted = useRef(true)
  const editable = status === 'draft' || status === 'changes_requested'
  const isBatchRunning = localUploads.some(
    (item) => item.status === 'uploading'
  )
  // Reordering and uploading both write display_order, so neither may start
  // while the other is running.
  const isBusy = isBatchRunning || savingOrder

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

  /** The draft existing is what "unsaved order" means, so the store flag and the
   *  in-memory sequence are always set together. */
  const applyOrderKeys = useCallback(
    (keys: string[] | null) => {
      orderKeysRef.current = keys
      if (mounted.current) {
        setOrderKeys(keys)
        setAssetDraftState({ orderDirty: keys !== null })
      }
    },
    [setAssetDraftState]
  )

  const releasePreview = useCallback((clientAssetId: string) => {
    const url = previewUrls.current.get(clientAssetId)
    if (url) URL.revokeObjectURL(url)
    previewUrls.current.delete(clientAssetId)
  }, [])

  useEffect(() => {
    mounted.current = true
    setSelected(new Set())
    // Cleared before the stored sequence is read, so switching submissions can
    // never carry the previous one's order into the new gallery.
    savingOrderRef.current = false
    setSavingOrder(false)
    orderKeysRef.current = null
    setOrderKeys(null)
    setAssetDraftState({
      localCount: 0,
      uploadsInFlight: 0,
      loaded: false,
      orderDirty: false
    })
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

    // A restored sequence stays unsaved: the cloud rows still hold the order
    // they had before the author dragged them.
    const restoreOrder = async () => {
      try {
        const stored = await loadPatchSubmissionGalleryOrder(submissionId)
        if (cancelled) return
        applyOrderKeys(stored?.length ? stored : null)
      } catch (error) {
        console.error('Failed to restore submission gallery order', error)
      }
    }
    void restoreOrder()

    const restoreWatermark = async () => {
      try {
        const stored = await loadPatchSubmissionWatermark(submissionId)
        if (!cancelled) setWatermark(stored)
      } catch (error) {
        console.error('Failed to restore submission watermark option', error)
      }
    }
    void restoreWatermark()

    return () => {
      cancelled = true
      mounted.current = false
      for (const url of previewUrls.current.values()) {
        URL.revokeObjectURL(url)
      }
      previewUrls.current.clear()
    }
  }, [applyOrderKeys, setAssetDraftState, submissionId, updateLocalState])

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

          // A drop during the batch can have written a new sequence, and the
          // row that just became ready has to take over the slot its local card
          // held instead of falling to the end of an unknown key list.
          const pending = orderKeysRef.current
          if (pending) {
            const promoted = pending.map((key) =>
              key === localSelectionKey(clientAssetId)
                ? serverSelectionKey(response.gallery.id)
                : key
            )
            applyOrderKeys(promoted)
            try {
              await savePatchSubmissionGalleryOrder(submissionId, promoted)
            } catch (persistError) {
              console.error('Failed to persist submission gallery order', {
                persistError
              })
            }
          }

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
      applyOrderKeys,
      persistLocalState,
      releasePreview,
      setAssetDraftState,
      setGallery,
      submissionId
    ]
  )

  const entries = buildOrderedEntries(gallery, localUploads, orderKeys)
  const visibleGallery = entries.flatMap((entry) =>
    entry.image ? [entry.image] : []
  )
  const localIds = new Set(localUploads.map((item) => item.clientAssetId))
  const serverSlotCount = gallery.filter(
    (image) =>
      image.uploadStatus !== 'failed' && !localIds.has(image.clientAssetId)
  ).length
  const totalSlotCount = serverSlotCount + localUploads.length
  const uploadableCount = localUploads.filter(
    (item) => item.status === 'pending' || item.status === 'failed'
  ).length

  /**
   * Records a new sequence without sending it. The cloud rows only move on an
   * explicit save, so the draft is the sole carrier of the author's intent, and
   * every local file takes the display order of the slot it now occupies — that
   * is the position it will keep once it becomes a cloud row.
   */
  const applyOrder = useCallback(
    async (nextKeys: string[], nextItems = localUploadsRef.current) => {
      orderGeneration.current += 1
      const positions = new Map(nextKeys.map((key, index) => [key, index]))
      const positioned = nextItems.map((item) => {
        const position = positions.get(localSelectionKey(item.clientAssetId))
        return position === undefined
          ? item
          : { ...item, displayOrder: position }
      })

      applyOrderKeys(nextKeys)
      try {
        await savePatchSubmissionGalleryOrder(submissionId, nextKeys)
        await persistLocalState(positioned)
        return true
      } catch (error) {
        console.error('Failed to persist submission gallery order', error)
        return false
      }
    },
    [applyOrderKeys, persistLocalState, submissionId]
  )

  /**
   * The single writer of gallery order. It freezes the sequence and the drag
   * generation before the request, so a save that lands after another drag
   * updates the rows it promised and still leaves the draft in place.
   */
  const saveGalleryOrder = useCallback(async () => {
    const keys = orderKeysRef.current
    if (!keys || savingOrderRef.current || batchRunning.current) return false

    const generation = orderGeneration.current
    const frozen = buildOrderedEntries(
      usePatchSubmissionStore.getState().gallery,
      localUploadsRef.current,
      keys
    ).map((entry, index) => ({ entry, index }))
    const order = frozen
      .filter(({ entry }) => entry.image?.uploadStatus === 'ready')
      .map(({ entry, index }) => ({
        galleryId: entry.image!.id,
        displayOrder: index
      }))

    savingOrderRef.current = true
    if (mounted.current) setSavingOrder(true)
    try {
      const response = await kunFetchPatch<string | Record<string, never>>(
        '/patch-submission/asset',
        { action: 'order', submissionId, order }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return false
      }

      const saved = new Map(
        order.map((entry) => [entry.galleryId, entry.displayOrder])
      )
      setGallery(
        usePatchSubmissionStore
          .getState()
          .gallery.map((image) =>
            saved.has(image.id)
              ? { ...image, displayOrder: saved.get(image.id) as number }
              : image
          )
      )

      if (generation !== orderGeneration.current) {
        // The author kept dragging while this was in flight, so the sequence on
        // screen is newer than the one the server just accepted.
        return false
      }

      await persistLocalState(
        frozen.flatMap(({ entry, index }) =>
          entry.item ? [{ ...entry.item, displayOrder: index }] : []
        )
      )
      await clearPatchSubmissionGalleryOrder(submissionId)
      applyOrderKeys(null)
      return true
    } catch (error) {
      console.error('Failed to save submission gallery order', error)
      toast.error('保存截图顺序失败，请检查网络后重试')
      return false
    } finally {
      savingOrderRef.current = false
      if (mounted.current) setSavingOrder(false)
    }
  }, [applyOrderKeys, persistLocalState, setGallery, submissionId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const keys = entries.map((entry) => entry.key)
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return

    if (!(await applyOrder(arrayMove(keys, from, to)))) {
      toast.error('保存截图顺序失败，请重试')
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    getFilesFromEvent: getGalleryFilesFromEvent,
    accept: { 'image/*': [] },
    // A drop rewrites the sequence, which is exactly what a save has frozen.
    disabled: !editable || savingOrder,
    onDrop: async (accepted: File[]) => {
      const valid = accepted.filter((file) => checkImageValid(file))
      if (!valid.length) return
      if (totalSlotCount + valid.length > PATCH_SUBMISSION_GALLERY_MAX_COUNT) {
        toast.error(`截图最多 ${PATCH_SUBMISSION_GALLERY_MAX_COUNT} 张`)
        return
      }

      const nextItems = valid.map((file) => {
        const clientAssetId = generateUUID().replace(/-/g, '')
        const previewUrl = URL.createObjectURL(file)
        previewUrls.current.set(clientAssetId, previewUrl)
        return {
          clientAssetId,
          blob: file,
          fileName: file.name,
          mimeType: file.type,
          lastModified: file.lastModified,
          displayOrder: 0,
          isNSFW: false,
          watermark,
          status: 'pending' as const,
          error: null,
          previewUrl
        }
      })

      // Appending changes the sequence, so it goes through the same draft as a
      // drag does: the new files take the slots after everything on screen, and
      // the cloud rows are repacked to match on the next save. Picking their
      // display orders any other way could collide with a row the author has
      // already uploaded.
      const nextKeys = [
        ...entries.map((entry) => entry.key),
        ...nextItems.map((item) => localSelectionKey(item.clientAssetId))
      ]
      const stored = await applyOrder(nextKeys, [
        ...localUploadsRef.current,
        ...nextItems
      ])
      if (!stored) {
        for (const item of nextItems) releasePreview(item.clientAssetId)
        toast.error('保存待上传截图失败，请重试')
      }
    }
  })

  const handleSetWatermark = async (value: boolean) => {
    setWatermark(value)
    try {
      await savePatchSubmissionWatermark(submissionId, value)
    } catch (error) {
      console.error('Failed to persist submission watermark option', error)
    }
  }

  /**
   * Uploading writes display_order, so an unsaved sequence has to reach the
   * server first or the new row lands in a slot the author no longer wants.
   * Anything that stops that save also stops the upload.
   */
  const uploadWithSavedOrder = async (clientAssetIds: string[]) => {
    if (batchRunning.current || savingOrderRef.current) return
    if (orderKeysRef.current && !(await saveGalleryOrder())) {
      toast.error('截图顺序尚未保存，已取消上传')
      return
    }
    await uploadItems(clientAssetIds)
  }

  /** The switch is frozen into every targeted item before the first request,
   *  so an interrupted batch retries with the value the author chose. */
  const startUpload = async () => {
    if (batchRunning.current || savingOrderRef.current) return
    const targets = localUploadsRef.current.filter(
      (item) => item.status === 'pending' || item.status === 'failed'
    )
    if (!targets.length) return

    const targetIds = new Set(targets.map((item) => item.clientAssetId))
    const frozen = localUploadsRef.current.map((item) =>
      targetIds.has(item.clientAssetId) ? { ...item, watermark } : item
    )
    try {
      await persistLocalState(frozen)
    } catch (error) {
      console.error('Failed to persist submission watermark snapshot', error)
      toast.error('保存水印设置失败，未开始上传')
      return
    }

    await uploadWithSavedOrder([...targetIds])
  }

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

  const deleteImages = async (galleryIds: number[]) => {
    try {
      const response = await kunFetchDeleteBody<string | Record<string, never>>(
        '/patch-submission/asset',
        { submissionId, galleryIds }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return false
      }
      const removed = new Set(galleryIds)
      setGallery(
        usePatchSubmissionStore
          .getState()
          .gallery.filter((image) => !removed.has(image.id))
      )
      return true
    } catch (error) {
      console.error('Failed to delete submission gallery images', error)
      toast.error('删除截图失败，请检查网络后重试')
      return false
    }
  }

  const deleteImage = async (galleryId: number) => {
    if (await deleteImages([galleryId])) {
      setSelected((current) => {
        const next = new Set(current)
        next.delete(serverSelectionKey(galleryId))
        return next
      })
    }
  }

  const selectedServerIds = visibleGallery
    .filter((image) => selected.has(serverSelectionKey(image.id)))
    .map((image) => image.id)
  const selectedReadyServerIds = visibleGallery
    .filter(
      (image) =>
        image.uploadStatus === 'ready' &&
        selected.has(serverSelectionKey(image.id))
    )
    .map((image) => image.id)
  const selectedLocalIds = localUploads
    .filter(
      (item) =>
        item.status !== 'uploading' &&
        selected.has(localSelectionKey(item.clientAssetId))
    )
    .map((item) => item.clientAssetId)

  /** The server call goes first: dropping the local Blob before the row is
   *  gone would leave nothing to retry with. */
  const deleteSelected = async () => {
    if (!selectedServerIds.length && !selectedLocalIds.length) return
    setDeleting(true)
    try {
      if (
        selectedServerIds.length &&
        !(await deleteImages(selectedServerIds))
      ) {
        return
      }

      if (selectedLocalIds.length) {
        const removing = new Set(selectedLocalIds)
        const next = localUploadsRef.current.filter(
          (item) => !removing.has(item.clientAssetId)
        )
        try {
          await persistLocalState(next)
          for (const clientAssetId of removing) releasePreview(clientAssetId)
        } catch (error) {
          console.error('Failed to remove submission upload draft items', error)
          toast.error('移除待上传截图失败，请重试')
          return
        }
      }

      setSelected(new Set())
    } finally {
      setDeleting(false)
    }
  }

  const setSelectedNSFW = async (isNSFW: boolean) => {
    const galleryIds = selectedReadyServerIds
    if (!galleryIds.length) return
    setUpdatingNSFW(true)
    try {
      const response = await kunFetchPatch<string | Record<string, never>>(
        '/patch-submission/asset',
        { action: 'nsfw', submissionId, galleryIds, isNSFW }
      )
      if (typeof response === 'string') {
        toast.error(response)
        return
      }
      const updated = new Set(galleryIds)
      setGallery(
        usePatchSubmissionStore
          .getState()
          .gallery.map((image) =>
            updated.has(image.id) ? { ...image, isNSFW } : image
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

  const toggleSelection = (key: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
            <Switch
              isSelected={watermark}
              isDisabled={isBusy}
              onValueChange={(value) => void handleSetWatermark(value)}
            >
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

      {isBusy && (
        <p className="text-sm text-default-500">
          {savingOrder ? '正在保存排序' : '正在上传截图'}
        </p>
      )}

      {editable && (
        <div
          {...getRootProps()}
          className={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors',
            isDragActive
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

      {editable && (uploadableCount > 0 || isBatchRunning) && (
        <Button
          color="primary"
          isLoading={isBatchRunning}
          isDisabled={uploadableCount === 0 || savingOrder}
          onPress={() => void startUpload()}
        >
          上传 {uploadableCount} 张截图
        </Button>
      )}

      {/* Deliberately outside the card list: deleting every screenshot while a
          drag is unsaved must still leave a way to confirm the empty order,
          otherwise the draft would block submission with nothing left to move. */}
      {editable && orderKeys && (
        <div className="space-y-2">
          <Button
            size="sm"
            color="primary"
            variant="flat"
            isLoading={savingOrder}
            isDisabled={isBatchRunning}
            onPress={() => void saveGalleryOrder()}
          >
            保存排序
          </Button>
          <p className="text-sm text-warning">
            截图顺序尚未保存, 请点击「保存排序」后再提交审核。
          </p>
        </div>
      )}

      {(visibleGallery.length > 0 || localUploads.length > 0) && (
        <div className="space-y-3">
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                color="danger"
                variant="flat"
                isLoading={deleting}
                isDisabled={
                  savingOrder ||
                  (!selectedServerIds.length && !selectedLocalIds.length)
                }
                onPress={() => void deleteSelected()}
              >
                删除选中 ({selectedServerIds.length + selectedLocalIds.length})
              </Button>
              <Button
                size="sm"
                color="warning"
                variant="flat"
                isLoading={updatingNSFW}
                isDisabled={savingOrder || !selectedReadyServerIds.length}
                onPress={() => void setSelectedNSFW(true)}
              >
                设为 NSFW
              </Button>
              <Button
                size="sm"
                color="success"
                variant="flat"
                isDisabled={
                  savingOrder || updatingNSFW || !selectedReadyServerIds.length
                }
                onPress={() => void setSelectedNSFW(false)}
              >
                设为 SFW
              </Button>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KunImageViewer images={viewerImages}>
                {(openLightbox) => (
                  <SortableContext
                    items={entries.map((entry) => entry.key)}
                    strategy={rectSortingStrategy}
                  >
                    {entries.map((entry, index) => {
                      const label = `第 ${index + 1} 张截图`
                      return (
                        <SortableGalleryItem
                          key={entry.key}
                          id={entry.key}
                          label={
                            entry.image
                              ? label
                              : `待上传图片 ${entry.item!.fileName}`
                          }
                          disabled={!editable || isBusy}
                        >
                          {entry.image ? (
                            <SubmissionGalleryCard
                              image={entry.image}
                              label={label}
                              selected={selected.has(entry.key)}
                              editable={editable}
                              busy={savingOrder}
                              onToggle={() => toggleSelection(entry.key)}
                              onOpenLightbox={() => {
                                const viewerIndex = viewerImages.findIndex(
                                  (candidate) =>
                                    candidate.src === entry.image?.imageUrl
                                )
                                if (viewerIndex >= 0) openLightbox(viewerIndex)
                              }}
                              onDelete={() => void deleteImage(entry.image!.id)}
                            />
                          ) : (
                            <LocalUploadCard
                              item={entry.item!}
                              editable={editable}
                              selected={selected.has(entry.key)}
                              busy={isBusy}
                              onToggle={() => toggleSelection(entry.key)}
                              onRetry={() =>
                                void uploadWithSavedOrder([
                                  entry.item!.clientAssetId
                                ])
                              }
                              onRemove={() =>
                                void removeLocalUpload(
                                  entry.item!.clientAssetId
                                )
                              }
                            />
                          )}
                        </SortableGalleryItem>
                      )
                    })}
                  </SortableContext>
                )}
              </KunImageViewer>
            </div>
          </DndContext>
        </div>
      )}
    </div>
  )
}
