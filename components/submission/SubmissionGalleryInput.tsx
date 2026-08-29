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
import { createSerialTaskQueue } from '~/utils/serialTaskQueue'
import { cn } from '~/utils/cn'
import type { PatchSubmissionGalleryImage } from '~/types/api/patchSubmission'

interface LocalUploadView extends PatchSubmissionLocalUpload {
  previewUrl: string
}

/** What the sequencing below needs from a local file, so the stored records and
 *  the rendered cards can both be arranged by the same code. */
type GalleryLocalItem = Pick<
  PatchSubmissionLocalUpload,
  'clientAssetId' | 'displayOrder'
>

/** One selection set spans both cloud rows and local pending files, so every
 *  key carries its own namespace. The same keys are what the saved order draft
 *  records, so a sequence survives a refresh across both stores. */
const serverSelectionKey = (galleryId: number) => `server:${galleryId}`
const localSelectionKey = (clientAssetId: string) => `local:${clientAssetId}`

/** Keeps the first occurrence, which is the position the author arranged. */
const dedupeKeys = (keys: string[]) => [...new Set(keys)]

/**
 * Rewrites a sequence that was derived from a rendered snapshot so it names the
 * cards that exist now: a `local:` key whose file has meanwhile landed as a
 * ready cloud row *is* that row. Without this, a sequence computed a moment
 * before an upload finished would be written back over the promotion.
 */
const promoteOrderKeys = (
  keys: string[],
  gallery: PatchSubmissionGalleryImage[]
) => {
  const promoted = new Map(
    gallery
      .filter((image) => image.uploadStatus === 'ready')
      .map((image) => [
        localSelectionKey(image.clientAssetId),
        serverSelectionKey(image.id)
      ])
  )
  return dedupeKeys(keys.map((key) => promoted.get(key) ?? key))
}

interface GalleryEntry<T> {
  key: string
  image: PatchSubmissionGalleryImage | null
  item: T | null
}

/**
 * The one sequence both stores are read through. While an order draft exists it
 * wins outright, because it is the arrangement the author dragged and the server
 * has not accepted yet; without one the persisted display orders are the truth,
 * which is what lets a freshly uploaded row take over the slot its local card
 * held. Ties keep the cloud rows ahead of local files, so the merge is stable.
 */
const buildOrderedEntries = <T extends GalleryLocalItem>(
  gallery: PatchSubmissionGalleryImage[],
  localUploads: T[],
  orderKeys: string[] | null
): GalleryEntry<T>[] => {
  const localIds = new Set(localUploads.map((item) => item.clientAssetId))
  const entries: GalleryEntry<T>[] = [
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
  const rankOf = (entry: GalleryEntry<T>) =>
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

const sameSequence = (left: string[] | null, right: string[] | null) =>
  left === right ||
  (!!left &&
    !!right &&
    left.length === right.length &&
    left.every((key, index) => key === right[index]))

/**
 * What the two stored keys mean once the cloud rows are consulted.
 *
 * A finished upload promotes its `local:` key and then drops its local item, and
 * those are two storage writes. A refresh in the gap leaves a ready cloud row
 * whose file is still sitting in the local list, with the sequence naming either
 * one of them. The ready row is the record of what actually happened, so it
 * wins: the local item goes and the sequence names the row, which is what keeps
 * one screenshot from coming back as two cards.
 *
 * Only ready rows reconcile. A `failed` placeholder means the bytes never
 * landed, and the local Blob is the only thing left to retry with.
 */
const reconcileRestoredDraft = <T extends GalleryLocalItem>(
  gallery: PatchSubmissionGalleryImage[],
  storedItems: T[],
  storedOrder: string[] | null
) => {
  const uploadedIds = new Set(
    gallery
      .filter((image) => image.uploadStatus === 'ready')
      .map((image) => image.clientAssetId)
  )
  const items = storedItems.filter(
    (item) => !uploadedIds.has(item.clientAssetId)
  )

  if (!storedOrder) return { items, orderKeys: null }

  const present = buildOrderedEntries(gallery, items, null).map(
    (entry) => entry.key
  )
  const available = new Set(present)
  const orderKeys = promoteOrderKeys(storedOrder, gallery).filter((key) =>
    available.has(key)
  )
  // A card the stored sequence never named still has to appear somewhere, and
  // its persisted display order is the only claim it has to a position.
  const named = new Set(orderKeys)
  for (const key of present) {
    if (!named.has(key)) orderKeys.push(key)
  }

  return { items, orderKeys }
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
  onOpenLightbox,
  onRetry,
  onRemove
}: {
  item: LocalUploadView
  editable: boolean
  selected: boolean
  busy: boolean
  onToggle: () => void
  onOpenLightbox: () => void
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
          {/* The staged file is the only copy of what is about to be published,
              so it gets the same look-closer control a cloud row has. */}
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label={`放大查看待上传图片 ${item.fileName}`}
            onPress={onOpenLightbox}
          >
            <Maximize2 className="size-4" />
          </Button>
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

interface DraftWrite {
  /** Omitted leaves the stored items untouched. */
  items?: LocalUploadView[]
  /** Omitted leaves the stored sequence untouched; `null` removes it. */
  orderKeys?: string[] | null
}

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
  /** Both stored keys have to be read before the gallery can be edited at all:
   *  every edit derives a whole new sequence, and one derived from a half-read
   *  draft would overwrite the other half. */
  const [restoreState, setRestoreState] = useState<
    'restoring' | 'ready' | 'failed'
  >('restoring')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
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
  /** One queue per mounted editor; see persistDraft. */
  const draftWrites = useRef(createSerialTaskQueue())
  /** The submission the refs and the state currently describe. A storage task
   *  that outlives its submission still finishes its write, but must not report
   *  back into the state of the one that replaced it. */
  const activeSubmissionId = useRef(submissionId)
  const editable = status === 'draft' || status === 'changes_requested'
  const isBatchRunning = localUploads.some(
    (item) => item.status === 'uploading'
  )
  // Reordering and uploading both write display_order, so neither may start
  // while the other is running.
  const isBusy = isBatchRunning || savingOrder
  const restoring = restoreState !== 'ready'
  const galleryLocked = isBusy || restoring

  const isCurrent = useCallback(
    (forSubmissionId: number) =>
      mounted.current && activeSubmissionId.current === forSubmissionId,
    []
  )

  const updateLocalState = useCallback(
    (items: LocalUploadView[], loaded = true) => {
      if (!mounted.current) return
      localUploadsRef.current = items
      setLocalUploads(items)
      setAssetDraftState({ localCount: items.length, loaded })
    },
    [setAssetDraftState]
  )

  /** The draft existing is what "unsaved order" means, so the store flag and the
   *  in-memory sequence are always set together. */
  const applyOrderKeys = useCallback(
    (keys: string[] | null) => {
      if (!mounted.current) return
      orderKeysRef.current = keys
      setOrderKeys(keys)
      setAssetDraftState({ orderDirty: keys !== null })
    },
    [setAssetDraftState]
  )

  /**
   * Every write to either draft key runs here, one at a time, and derives its
   * next value from what the task before it left behind. Callers used to compute
   * a whole array from the render they were triggered by and race each other to
   * storage, so an upload finishing while the author dropped a file left
   * whichever wrote last as the only survivor.
   *
   * A write naming both keys is still two storage operations, so the order is
   * chosen so a crash in between leaves something recoverable: a new sequence
   * goes first, because a promoted `server:` key beside a local item that is
   * still listed is exactly what the mount reconciliation repairs, while
   * dropping the sequence goes last, because the record existing is the unsaved
   * flag and losing it early would hide work the author still has to confirm.
   */
  const persistDraft = useCallback(
    (
      compute: (current: {
        items: LocalUploadView[]
        orderKeys: string[] | null
      }) => DraftWrite
    ) =>
      draftWrites.current(async () => {
        const next = compute({
          items: localUploadsRef.current,
          orderKeys: orderKeysRef.current
        })
        const writesOrder = 'orderKeys' in next
        const nextOrderKeys = next.orderKeys ?? null

        const writeOrder = async () => {
          if (!writesOrder) return
          if (nextOrderKeys) {
            await savePatchSubmissionGalleryOrder(submissionId, nextOrderKeys)
          } else {
            await clearPatchSubmissionGalleryOrder(submissionId)
          }
        }
        const writeItems = async () => {
          if (!next.items) return
          await savePatchSubmissionUploadDraft(
            submissionId,
            toPersistedItems(next.items)
          )
        }

        if (writesOrder && !nextOrderKeys) {
          await writeItems()
          await writeOrder()
        } else {
          await writeOrder()
          await writeItems()
        }

        if (!isCurrent(submissionId)) return next
        if (writesOrder) applyOrderKeys(nextOrderKeys)
        if (next.items) updateLocalState(next.items)
        return next
      }),
    [applyOrderKeys, isCurrent, submissionId, updateLocalState]
  )

  const releasePreview = useCallback((clientAssetId: string) => {
    const url = previewUrls.current.get(clientAssetId)
    if (url) URL.revokeObjectURL(url)
    previewUrls.current.delete(clientAssetId)
  }, [])

  useEffect(() => {
    mounted.current = true
    activeSubmissionId.current = submissionId
    setSelected(new Set())
    // Cleared before the stored state is read, so switching submissions — or
    // retrying a failed read — can never carry the previous state into the new
    // gallery.
    savingOrderRef.current = false
    setSavingOrder(false)
    for (const url of previewUrls.current.values()) {
      URL.revokeObjectURL(url)
    }
    previewUrls.current.clear()
    applyOrderKeys(null)
    updateLocalState([], false)
    setAssetDraftState({ uploadsInFlight: 0 })
    setRestoreState('restoring')
    let cancelled = false

    /**
     * One restore, not three races. The gallery stays locked until every stored
     * key has landed, because `loaded` unlocking on the items alone let the
     * submit button open while the sequence was still unknown, and a drop
     * arriving mid-restore fought the restore's own write-back.
     */
    const restore = async () => {
      // The watermark switch is a preference rather than part of the draft's
      // integrity, so a failed read degrades to the default instead of locking
      // the draft. Edits still wait for it: a drop freezes the value the author
      // is looking at into every file it stages.
      const watermarkRead = loadPatchSubmissionWatermark(submissionId).then(
        (stored) => {
          if (!cancelled) setWatermark(stored)
        },
        (error) => {
          console.error('Failed to restore submission watermark option', error)
          if (cancelled) return
          setWatermark(true)
          toast.error('水印设置读取失败, 已恢复为默认开启, 请确认')
        }
      )

      let restored = false
      try {
        const [storedItems, storedOrder] = await Promise.all([
          loadPatchSubmissionUploadDraft(submissionId),
          loadPatchSubmissionGalleryOrder(submissionId)
        ])
        if (cancelled) return

        const valid = storedItems.filter((item) => item.blob instanceof Blob)
        const storedSequence = storedOrder?.length ? storedOrder : null
        const reconciled = reconcileRestoredDraft(
          usePatchSubmissionStore.getState().gallery,
          valid,
          storedSequence
        )
        const views = reconciled.items.map((item) => {
          const previewUrl = URL.createObjectURL(item.blob)
          previewUrls.current.set(item.clientAssetId, previewUrl)
          return { ...item, previewUrl }
        })

        // A restored sequence stays unsaved: the cloud rows still hold the order
        // they had before the author dragged them.
        applyOrderKeys(reconciled.orderKeys)
        await persistDraft(() =>
          sameSequence(storedSequence, reconciled.orderKeys)
            ? { items: views }
            : { items: views, orderKeys: reconciled.orderKeys }
        )
        restored = true
      } catch (error) {
        console.error('Failed to restore the submission gallery draft', error)
        if (!cancelled) toast.error('读取本地截图草稿失败, 请重试')
      }

      await watermarkRead
      if (cancelled) return
      setRestoreState(restored ? 'ready' : 'failed')
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
  }, [
    applyOrderKeys,
    persistDraft,
    restoreAttempt,
    setAssetDraftState,
    submissionId,
    updateLocalState
  ])

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
        const target = localUploadsRef.current.find(
          (item) => item.clientAssetId === clientAssetId
        )
        if (!target) {
          completed += 1
          if (mounted.current) {
            setProgress({ total: clientAssetIds.length, completed })
          }
          continue
        }

        try {
          await persistDraft(({ items }) => ({
            items: items.map((item) =>
              item.clientAssetId === clientAssetId
                ? { ...item, status: 'uploading' as const, error: null }
                : item
            )
          }))
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

          // One queue unit, sequence first. A drop during the batch can have
          // written a new sequence, and the row that just became ready has to
          // take over the slot its local card held instead of falling to the end
          // of an unknown key list. Promoting before the local item is dropped
          // means an interrupted pair leaves the row named and the stale card
          // behind, which the mount reconciliation resolves in the row's favour;
          // the reverse would leave the sequence pointing at nothing.
          try {
            await persistDraft(({ items, orderKeys: pending }) => {
              const remaining = items.filter(
                (item) => item.clientAssetId !== clientAssetId
              )
              if (!pending) return { items: remaining }
              return {
                orderKeys: dedupeKeys(
                  pending.map((key) =>
                    key === localSelectionKey(clientAssetId)
                      ? serverSelectionKey(response.gallery.id)
                      : key
                  )
                ),
                items: remaining
              }
            })
          } catch (persistError) {
            console.error(
              'Failed to persist the uploaded submission screenshot',
              persistError
            )
            // The row is ready on the server, and retrying this same client
            // asset id resolves to it, so the honest local state is a card the
            // author can press retry on.
            throw new Error('截图已上传, 但本地记录未能保存, 请重试')
          }
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
          try {
            await persistDraft(({ items }) => ({
              items: items.map((item) =>
                item.clientAssetId === clientAssetId
                  ? { ...item, status: 'failed' as const, error: message }
                  : item
              )
            }))
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
      persistDraft,
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
    async (nextKeys: string[], appended: LocalUploadView[] = []) => {
      orderGeneration.current += 1
      try {
        await persistDraft(({ items }) => {
          // The sequence was read off the rendered grid, so an upload that
          // promoted one of its cards in between has to be folded in rather than
          // written back out of existence.
          const keys = promoteOrderKeys(
            nextKeys,
            usePatchSubmissionStore.getState().gallery
          )
          const positions = new Map(keys.map((key, index) => [key, index]))
          return {
            orderKeys: keys,
            items: [...items, ...appended].map((item) => {
              const position = positions.get(
                localSelectionKey(item.clientAssetId)
              )
              return position === undefined
                ? item
                : { ...item, displayOrder: position }
            })
          }
        })
        return true
      } catch (error) {
        console.error('Failed to persist submission gallery order', error)
        return false
      }
    },
    [persistDraft]
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

      const positions = new Map(
        frozen.flatMap(({ entry, index }) =>
          entry.item ? [[entry.item.clientAssetId, index] as const] : []
        )
      )
      await persistDraft(({ items }) => ({
        items: items.map((item) => {
          const position = positions.get(item.clientAssetId)
          return position === undefined
            ? item
            : { ...item, displayOrder: position }
        }),
        orderKeys: null
      }))
      return true
    } catch (error) {
      console.error('Failed to save submission gallery order', error)
      toast.error('保存截图顺序失败，请检查网络后重试')
      return false
    } finally {
      savingOrderRef.current = false
      if (mounted.current) setSavingOrder(false)
    }
  }, [persistDraft, setGallery, submissionId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    // A sequence dragged before the stored one has been read would be built on
    // an unknown arrangement, and the restore's own write-back would fight it.
    if (!editable || restoring) return

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
    // A drop rewrites the sequence, which is exactly what a save has frozen and
    // what the restore is still reading.
    disabled: !editable || savingOrder || restoring,
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
      const stored = await applyOrder(nextKeys, nextItems)
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
    try {
      await persistDraft(({ items }) => ({
        items: items.map((item) =>
          targetIds.has(item.clientAssetId) ? { ...item, watermark } : item
        )
      }))
    } catch (error) {
      console.error('Failed to persist submission watermark snapshot', error)
      toast.error('保存水印设置失败，未开始上传')
      return
    }

    await uploadWithSavedOrder([...targetIds])
  }

  const removeLocalUpload = async (clientAssetId: string) => {
    try {
      await persistDraft(({ items }) => ({
        items: items.filter((item) => item.clientAssetId !== clientAssetId)
      }))
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
        try {
          await persistDraft(({ items }) => ({
            items: items.filter((item) => !removing.has(item.clientAssetId))
          }))
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

  /** The lightbox follows the grid, cloud rows and staged files alike, so
   *  stepping through it matches what the author sees on the page. */
  const viewerCards = entries.flatMap((entry, index) => {
    const src = entry.image ? entry.image.imageUrl : entry.item!.previewUrl
    if (!src) return []
    return [
      {
        key: entry.key,
        src,
        previewSrc: entry.image?.thumbnailUrl ?? undefined,
        alt: entry.image
          ? `第 ${index + 1} 张截图`
          : `待上传图片 ${entry.item!.fileName}`
      }
    ]
  })
  const viewerImages = viewerCards.map(({ key: _key, ...image }) => image)
  const openLightboxFor = (key: string, open: (index: number) => void) => {
    const index = viewerCards.findIndex((card) => card.key === key)
    if (index >= 0) open(index)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">游戏截图 (可选)</h2>
        <div className="flex flex-wrap items-center gap-3">
          {editable && (
            <Switch
              isSelected={watermark}
              isDisabled={galleryLocked}
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

      {restoreState === 'restoring' && (
        <p className="text-sm text-default-500">正在读取本地截图</p>
      )}

      {/* The stored draft is the only record of what is staged and in what
          order, so an unread one leaves nothing safe to edit against. */}
      {restoreState === 'failed' && (
        <div className="space-y-2">
          <p className="text-sm text-danger">
            读取本地截图草稿失败, 截图编辑已暂停, 请重试。
          </p>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            onPress={() => setRestoreAttempt((attempt) => attempt + 1)}
          >
            重试读取
          </Button>
        </div>
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
          isDisabled={uploadableCount === 0 || savingOrder || restoring}
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
            isDisabled={isBatchRunning || restoring}
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
                  restoring ||
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
                isDisabled={
                  savingOrder || restoring || !selectedReadyServerIds.length
                }
                onPress={() => void setSelectedNSFW(true)}
              >
                设为 NSFW
              </Button>
              <Button
                size="sm"
                color="success"
                variant="flat"
                isDisabled={
                  savingOrder ||
                  restoring ||
                  updatingNSFW ||
                  !selectedReadyServerIds.length
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
                          disabled={!editable || galleryLocked}
                        >
                          {entry.image ? (
                            <SubmissionGalleryCard
                              image={entry.image}
                              label={label}
                              selected={selected.has(entry.key)}
                              editable={editable}
                              busy={savingOrder || restoring}
                              onToggle={() => toggleSelection(entry.key)}
                              onOpenLightbox={() =>
                                openLightboxFor(entry.key, openLightbox)
                              }
                              onDelete={() => void deleteImage(entry.image!.id)}
                            />
                          ) : (
                            <LocalUploadCard
                              item={entry.item!}
                              editable={editable}
                              selected={selected.has(entry.key)}
                              busy={galleryLocked}
                              onToggle={() => toggleSelection(entry.key)}
                              onOpenLightbox={() =>
                                openLightboxFor(entry.key, openLightbox)
                              }
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
