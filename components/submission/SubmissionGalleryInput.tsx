'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
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
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
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
import type {
  DragEndEvent,
  DragStartEvent,
  DropAnimation
} from '@dnd-kit/core'
import { restrictToParentElement } from '~/utils/dndModifiers'
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
import {
  createSerialTaskQueue,
  type SerialTaskQueue
} from '~/utils/serialTaskQueue'
import { cn } from '~/utils/cn'
import type { PatchSubmissionGalleryImage } from '~/types/api/patchSubmission'
import type { PatchSubmissionSaveResult } from '~/hooks/usePatchSubmissionAutosave'

export interface SubmissionGalleryHandle {
  flushOrder: () => Promise<PatchSubmissionSaveResult>
}

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
 * The dragged copy animates from where the pointer let go into the slot the card
 * landed in. The card it came from keeps the dimmed look it had during the drag
 * until that finishes, so the two are never both solid at once.
 */
const galleryDropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.5' } }
  })
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
        // `touch-none` is what makes this work on a phone at all: pointer event
        // listeners cannot prevent the browser's native touch behaviour, so
        // without it the first finger movement scrolls the page and cancels the
        // pointer, and the drag never activates. Only the handle opts out, so
        // the gallery itself still scrolls. The target is finger-sized below
        // `sm`, where the card is half the screen wide.
        className="absolute left-3 top-3 z-20 inline-flex size-11 touch-none select-none items-center justify-center rounded-medium bg-background/80 text-default-600 shadow-small outline-none transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 sm:size-7"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-5 sm:size-4" />
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

/**
 * One submission's draft: the authoritative staged state, the storage namespace
 * it belongs to, and the queue its writes serialize on.
 *
 * Every asynchronous chain binds one of these at its origin — the drop, the drag,
 * the removal, the batch — and carries it to the end instead of re-reading which
 * submission is on screen halfway through. A chain that outlives its submission
 * therefore still computes from the state it started with and still writes only
 * its own keys, and the editor that replaced it neither feeds it nor hears from
 * it.
 */
interface DraftContext {
  submissionId: number
  items: LocalUploadView[]
  orderKeys: string[] | null
  gallery: PatchSubmissionGalleryImage[]
  orderGeneration: number
  synchronizingOrder: boolean
  orderFlushPromise: Promise<PatchSubmissionSaveResult> | null
  uploadRunning: boolean
  queue: SerialTaskQueue
}

const createDraftContext = (
  submissionId: number,
  gallery: PatchSubmissionGalleryImage[]
): DraftContext => ({
  submissionId,
  items: [],
  orderKeys: null,
  gallery: [...gallery],
  orderGeneration: 0,
  synchronizingOrder: false,
  orderFlushPromise: null,
  uploadRunning: false,
  queue: createSerialTaskQueue()
})

/**
 * The write that records one full sequence. The sequence names cards, so an
 * upload that promoted one of them has to be folded in rather than written back
 * out of existence, and every local file takes the display order of the slot it
 * now occupies — that is the position it will keep once it becomes a cloud row.
 */
const orderedDraftWrite = (
  sequence: string[],
  items: LocalUploadView[],
  gallery: PatchSubmissionGalleryImage[]
): DraftWrite => {
  const keys = promoteOrderKeys(sequence, gallery)
  const positions = new Map(keys.map((key, index) => [key, index]))
  return {
    orderKeys: keys,
    items: items.map((item) => {
      const position = positions.get(localSelectionKey(item.clientAssetId))
      return position === undefined ? item : { ...item, displayOrder: position }
    })
  }
}

export const SubmissionGalleryInput = forwardRef<SubmissionGalleryHandle>(
  function SubmissionGalleryInput(_props, ref) {
    const { submissionId, gallery, setGallery, status, setAssetDraftState } =
      usePatchSubmissionStore()
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [localUploads, setLocalUploads] = useState<LocalUploadView[]>([])
    // Watermark defaults on, matching the create page, so screenshots are marked
    // unless the author opts out.
    const [watermark, setWatermark] = useState(true)
    const [updatingNSFW, setUpdatingNSFW] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [synchronizingOrder, setSynchronizingOrder] = useState(false)
    const [orderKeys, setOrderKeys] = useState<string[] | null>(null)
    /** The card currently under the pointer, so the drag overlay knows what to
     *  draw. Null whenever no drag is in progress. */
    const [activeDragKey, setActiveDragKey] = useState<string | null>(null)
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
    const previewUrls = useRef(new Map<string, string>())
    const mounted = useRef(true)
    /** The draft the rendered state is a view of. Replaced whenever the editor
     *  changes submission, so everything still bound to the old one keeps its own
     *  state and its own storage keys. */
    const activeContext = useRef<DraftContext>(
      createDraftContext(submissionId, gallery)
    )
    const editable = status === 'draft' || status === 'changes_requested'
    const isBatchRunning = localUploads.some(
      (item) => item.status === 'uploading'
    )
    // Reordering and uploading both write display_order, so neither may start
    // while the other is running.
    const isBusy = isBatchRunning || synchronizingOrder
    // A submission id changes before its restore effect runs. Keep that interim
    // render locked so an event can never bind the context from the previous id.
    const restoring =
      restoreState !== 'ready' ||
      activeContext.current.submissionId !== submissionId
    const galleryLocked = isBusy || restoring

    /** Whether what this context holds is what the author is looking at. Only the
     *  view is gated on it; the context itself advances either way. */
    const isCurrent = useCallback(
      (ctx: DraftContext) =>
        mounted.current &&
        activeContext.current === ctx &&
        usePatchSubmissionStore.getState().submissionId === ctx.submissionId,
      []
    )

    /**
     * A context owns the cloud rows used to merge its local order as well as the
     * local records themselves. While it is active, pull in any newer server view
     * already hydrated into Zustand; after it is replaced, its private snapshot is
     * the only gallery an outliving task may read.
     */
    const readContextGallery = useCallback((ctx: DraftContext) => {
      const state = usePatchSubmissionStore.getState()
      if (
        activeContext.current === ctx &&
        state.submissionId === ctx.submissionId
      ) {
        ctx.gallery = state.gallery
      }
      return ctx.gallery
    }, [])

    const updateContextGallery = useCallback(
      (
        ctx: DraftContext,
        update: (
          current: PatchSubmissionGalleryImage[]
        ) => PatchSubmissionGalleryImage[]
      ) => {
        const next = update(readContextGallery(ctx))
        ctx.gallery = next
        if (isCurrent(ctx)) setGallery(next)
        return next
      },
      [isCurrent, readContextGallery, setGallery]
    )

    const syncLocalState = useCallback(
      (items: LocalUploadView[], loaded = true) => {
        setLocalUploads(items)
        setAssetDraftState({ localCount: items.length, loaded })
      },
      [setAssetDraftState]
    )

    /** The draft existing means the order still needs to be synchronized at the
     *  next meaningful action, so the store flag and rendered sequence stay in
     *  step even though authors do not manage that state directly. */
    const syncOrderKeys = useCallback(
      (keys: string[] | null) => {
        setOrderKeys(keys)
        setAssetDraftState({ orderDirty: keys !== null })
      },
      [setAssetDraftState]
    )

    /**
     * Every write to either draft key of one submission runs here, one at a time,
     * and derives its next value from what the task before it left behind.
     * Callers used to compute a whole array from the render they were triggered by
     * and race each other to storage, so an upload finishing while the author
     * dropped a file left whichever wrote last as the only survivor.
     *
     * A write naming both keys is still two storage operations, so the order is
     * chosen so a crash in between leaves something recoverable: a new sequence
     * goes first, because a promoted `server:` key beside a local item that is
     * still listed is exactly what the mount reconciliation repairs, while
     * dropping the sequence goes last, because the record existing marks pending
     * synchronization and losing it early would hide work that still must land.
     */
    const persistDraft = useCallback(
      (
        ctx: DraftContext,
        compute: (current: {
          items: LocalUploadView[]
          orderKeys: string[] | null
        }) => DraftWrite
      ) =>
        ctx.queue(async () => {
          const next = compute({ items: ctx.items, orderKeys: ctx.orderKeys })
          const writesOrder = 'orderKeys' in next
          const nextOrderKeys = next.orderKeys ?? null

          const writeOrder = async () => {
            if (!writesOrder) return
            if (nextOrderKeys) {
              await savePatchSubmissionGalleryOrder(
                ctx.submissionId,
                nextOrderKeys
              )
            } else {
              await clearPatchSubmissionGalleryOrder(ctx.submissionId)
            }
          }
          const writeItems = async () => {
            if (!next.items) return
            await savePatchSubmissionUploadDraft(
              ctx.submissionId,
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

          // What was stored is what this draft now holds, whether or not anyone is
          // still looking at it: the task behind this one reads the context, and
          // leaving it on the value this task just replaced is how a second upload
          // finishing after an unmount wrote the first one back into storage.
          if (writesOrder) ctx.orderKeys = nextOrderKeys
          if (next.items) ctx.items = next.items

          if (!isCurrent(ctx)) return next
          if (writesOrder) syncOrderKeys(nextOrderKeys)
          if (next.items) syncLocalState(next.items)
          return next
        }),
      [isCurrent, syncLocalState, syncOrderKeys]
    )

    const releasePreview = useCallback((clientAssetId: string) => {
      const url = previewUrls.current.get(clientAssetId)
      if (url) URL.revokeObjectURL(url)
      previewUrls.current.delete(clientAssetId)
    }, [])

    useEffect(() => {
      mounted.current = true
      // The new draft, and with it a new serialization domain. Whatever is still
      // running against the old one keeps writing the old one's keys.
      const state = usePatchSubmissionStore.getState()
      const ctx = createDraftContext(
        submissionId,
        state.submissionId === submissionId ? state.gallery : []
      )
      activeContext.current = ctx
      setSelected(new Set())
      // Cleared before the stored state is read, so switching submissions — or
      // retrying a failed read — can never carry the previous state into the new
      // gallery. The progress bar goes with it: a batch left behind by the
      // previous submission no longer reports into this one's view, so its bar
      // would otherwise stay frozen at the count it had on the way out.
      setSynchronizingOrder(false)
      setDeleting(false)
      setUpdatingNSFW(false)
      setActiveDragKey(null)
      setProgress(null)
      for (const url of previewUrls.current.values()) {
        URL.revokeObjectURL(url)
      }
      previewUrls.current.clear()
      syncOrderKeys(null)
      syncLocalState([], false)
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
            console.error(
              'Failed to restore submission watermark option',
              error
            )
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
            readContextGallery(ctx),
            valid,
            storedSequence
          )
          const views = reconciled.items.map((item) => {
            const previewUrl = URL.createObjectURL(item.blob)
            previewUrls.current.set(item.clientAssetId, previewUrl)
            return { ...item, previewUrl }
          })

          // A restored sequence stays pending: the cloud rows still hold the order
          // they had before the author dragged them.
          ctx.orderKeys = reconciled.orderKeys
          syncOrderKeys(reconciled.orderKeys)
          await persistDraft(ctx, () =>
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
      persistDraft,
      readContextGallery,
      restoreAttempt,
      setAssetDraftState,
      submissionId,
      syncLocalState,
      syncOrderKeys
    ])

    const uploadItems = useCallback(
      async (ctx: DraftContext, clientAssetIds: string[]) => {
        if (ctx.uploadRunning || !clientAssetIds.length) return
        ctx.uploadRunning = true
        if (isCurrent(ctx)) {
          setProgress({ total: clientAssetIds.length, completed: 0 })
          setAssetDraftState({ uploadsInFlight: 1 })
        }

        let completed = 0
        for (const clientAssetId of clientAssetIds) {
          const target = ctx.items.find(
            (item) => item.clientAssetId === clientAssetId
          )
          if (!target) {
            completed += 1
            if (isCurrent(ctx)) {
              setProgress({ total: clientAssetIds.length, completed })
            }
            continue
          }

          try {
            await persistDraft(ctx, ({ items }) => ({
              items: items.map((item) =>
                item.clientAssetId === clientAssetId
                  ? { ...item, status: 'uploading' as const, error: null }
                  : item
              )
            }))
            const formData = new FormData()
            formData.set('submissionId', String(ctx.submissionId))
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
              await persistDraft(ctx, ({ items, orderKeys: pending }) => {
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

            updateContextGallery(ctx, (latest) =>
              [
                ...latest.filter(
                  (image) =>
                    image.id !== response.gallery.id &&
                    image.clientAssetId !== response.gallery.clientAssetId
                ),
                response.gallery
              ].sort(
                (left, right) =>
                  left.displayOrder - right.displayOrder || left.id - right.id
              )
            )
          } catch (error) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : '上传失败，请重试'
            try {
              await persistDraft(ctx, ({ items }) => ({
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
            if (isCurrent(ctx)) toast.error(message)
          } finally {
            completed += 1
            if (isCurrent(ctx)) {
              setProgress({ total: clientAssetIds.length, completed })
            }
          }
        }

        ctx.uploadRunning = false
        if (isCurrent(ctx)) setAssetDraftState({ uploadsInFlight: 0 })
      },
      [
        isCurrent,
        persistDraft,
        releasePreview,
        setAssetDraftState,
        updateContextGallery
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
     * Records a sequence the author dragged without sending it immediately. The
     * sequence is frozen at the drag because that sequence *is* the gesture; a
     * later upload, draft save, preview or submit synchronizes it to the server.
     */
    const applyOrder = useCallback(
      async (ctx: DraftContext, nextKeys: string[]) => {
        ctx.orderGeneration += 1
        try {
          await persistDraft(ctx, ({ items }) =>
            orderedDraftWrite(nextKeys, items, readContextGallery(ctx))
          )
          return true
        } catch (error) {
          console.error('Failed to persist submission gallery order', error)
          return false
        }
      },
      [persistDraft, readContextGallery]
    )

    /**
     * Stages dropped files at the end of the gallery. Unlike a drag, an append
     * names no arrangement of its own, so the count and the sequence are decided
     * inside the write queue rather than from the grid the files were dropped
     * onto: two drops in quick succession are two tasks, and the second has to see
     * the slots the first one took and name its keys in the sequence it writes.
     * Deciding either at the event would let the second drop pass a cap that no
     * longer holds and overwrite the first drop's sequence with one that never
     * mentioned it.
     */
    const appendLocalUploads = useCallback(
      async (ctx: DraftContext, staged: LocalUploadView[]) => {
        let rejected = false
        try {
          await persistDraft(ctx, ({ items, orderKeys: pending }) => {
            const gallery = readContextGallery(ctx)
            const localIds = new Set(items.map((item) => item.clientAssetId))
            const occupied =
              gallery.filter(
                (image) =>
                  image.uploadStatus !== 'failed' &&
                  !localIds.has(image.clientAssetId)
              ).length + items.length
            // The cap is re-read here rather than at the drop, because two drops
            // in quick succession both read the same count off the grid and both
            // pass a cap that only one of them still fits under. A rejected append
            // writes nothing at all, so the draft is exactly what it was.
            if (occupied + staged.length > PATCH_SUBMISSION_GALLERY_MAX_COUNT) {
              rejected = true
              return {}
            }

            ctx.orderGeneration += 1
            // The new files take the slots after everything currently in the
            // gallery, and the cloud rows are repacked on the next synchronization.
            // Picking their display orders any other way could collide with a row
            // the author has already uploaded.
            const sequence = [
              ...buildOrderedEntries(gallery, items, pending).map(
                (entry) => entry.key
              ),
              ...staged.map((item) => localSelectionKey(item.clientAssetId))
            ]
            return orderedDraftWrite(sequence, [...items, ...staged], gallery)
          })
          return rejected ? 'rejected' : 'stored'
        } catch (error) {
          console.error('Failed to persist the staged submission screenshots', {
            error
          })
          return 'failed'
        }
      },
      [persistDraft, readContextGallery]
    )

    /**
     * Synchronizes the current order for the surrounding draft workflow.
     * Concurrent callers share one operation. If the sequence changes while a
     * request is in flight, the same operation continues with the newer draft
     * before reporting success.
     */
    const flushGalleryOrder = useCallback(
      (ctx: DraftContext): Promise<PatchSubmissionSaveResult> => {
        if (ctx.orderFlushPromise) return ctx.orderFlushPromise

        const operation = (async (): Promise<PatchSubmissionSaveResult> => {
          // A drag renders its sequence at once and writes it behind the queue,
          // so reading the draft straight away could miss the very gesture that
          // prompted this flush and freeze the order the author already replaced.
          // Draining first is what makes "the order when you saved" mean the
          // order that was on screen.
          await ctx.queue(async () => undefined)
          if (!ctx.orderKeys) return { ok: true }
          if (ctx.uploadRunning) {
            return {
              ok: false,
              reason: 'error',
              message: '截图正在上传，请等待完成后重试'
            }
          }

          ctx.synchronizingOrder = true
          if (isCurrent(ctx)) setSynchronizingOrder(true)
          try {
            while (ctx.orderKeys) {
              const keys = ctx.orderKeys
              const generation = ctx.orderGeneration
              const frozen = buildOrderedEntries(
                readContextGallery(ctx),
                ctx.items,
                keys
              ).map((entry, index) => ({ entry, index }))
              const order = frozen
                .filter(({ entry }) => entry.image?.uploadStatus === 'ready')
                .map(({ entry, index }) => ({
                  galleryId: entry.image!.id,
                  displayOrder: index
                }))

              const response = await kunFetchPatch<
                string | Record<string, never>
              >('/patch-submission/asset', {
                action: 'order',
                submissionId: ctx.submissionId,
                order
              })
              if (typeof response === 'string') {
                return { ok: false, reason: 'error', message: response }
              }

              const synchronized = new Map(
                order.map((entry) => [entry.galleryId, entry.displayOrder])
              )
              updateContextGallery(ctx, (current) =>
                current.map((image) =>
                  synchronized.has(image.id)
                    ? {
                        ...image,
                        displayOrder: synchronized.get(image.id) as number
                      }
                    : image
                )
              )

              if (generation !== ctx.orderGeneration) {
                // A drag advances the generation before its localforage write is
                // queued. Wait behind that write before reading the next sequence,
                // otherwise this loop could send the previous keys again and then
                // clear the newer draft waiting in the queue.
                await ctx.queue(async () => undefined)
                continue
              }

              const positions = new Map(
                frozen.flatMap(({ entry, index }) =>
                  entry.item ? [[entry.item.clientAssetId, index] as const] : []
                )
              )
              await persistDraft(ctx, ({ items }) => ({
                items: items.map((item) => {
                  const position = positions.get(item.clientAssetId)
                  return position === undefined
                    ? item
                    : { ...item, displayOrder: position }
                }),
                orderKeys: null
              }))
            }
            return { ok: true }
          } catch (error) {
            console.error(
              'Failed to synchronize submission gallery order',
              error
            )
            return {
              ok: false,
              reason: 'error',
              message: '同步截图顺序失败，请检查网络后重试'
            }
          } finally {
            ctx.synchronizingOrder = false
            if (isCurrent(ctx)) setSynchronizingOrder(false)
          }
        })()

        ctx.orderFlushPromise = operation
        void operation.finally(() => {
          if (ctx.orderFlushPromise === operation) ctx.orderFlushPromise = null
        })
        return operation
      },
      [isCurrent, persistDraft, readContextGallery, updateContextGallery]
    )

    useImperativeHandle(
      ref,
      () => ({
        flushOrder: () => flushGalleryOrder(activeContext.current)
      }),
      [flushGalleryOrder]
    )

    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates
      })
    )

    const handleDragStart = (event: DragStartEvent) => {
      setActiveDragKey(String(event.active.id))
    }

    const handleDragEnd = async (event: DragEndEvent) => {
      setActiveDragKey(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      // A sequence dragged before the stored one has been read would be built on
      // an unknown arrangement, and the restore's own write-back would fight it.
      if (!editable || restoring) return

      const ctx = activeContext.current
      const keys = entries.map((entry) => entry.key)
      const from = keys.indexOf(String(active.id))
      const to = keys.indexOf(String(over.id))
      if (from < 0 || to < 0) return

      const previous = orderKeys
      const next = arrayMove(keys, from, to)
      // Rendered before the write is awaited rather than after it. dnd-kit
      // clears every drag transform on this same frame, so waiting for the
      // localforage round trip made the cards snap back to the old arrangement
      // and jump into the new one a few frames later — and the drop animation
      // aimed at the slot the card was leaving. The queued write still has the
      // last word: its own syncOrderKeys is what folds in keys an upload
      // promoted underneath.
      syncOrderKeys(next)
      if (!(await applyOrder(ctx, next)) && isCurrent(ctx)) {
        syncOrderKeys(previous)
        toast.error('记录截图顺序失败，请重试')
      }
    }

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
      getFilesFromEvent: getGalleryFilesFromEvent,
      accept: { 'image/*': [] },
      // A drop rewrites the sequence, which is exactly what a synchronization
      // has frozen and what the restore is still reading.
      disabled: !editable || synchronizingOrder || restoring,
      onDrop: async (accepted: File[]) => {
        const valid = accepted.filter((file) => checkImageValid(file))
        if (!valid.length) return

        const ctx = activeContext.current
        // Staged eagerly, so the previews exist by the time the write that admits
        // them lands. Whether they fit is not decided here: the count on the grid
        // is the one the previous drop has not been written into yet.
        const staged = valid.map((file) => {
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

        const outcome = await appendLocalUploads(ctx, staged)
        if (outcome === 'stored') return

        for (const item of staged) releasePreview(item.clientAssetId)
        if (isCurrent(ctx)) {
          toast.error(
            outcome === 'rejected'
              ? `截图最多 ${PATCH_SUBMISSION_GALLERY_MAX_COUNT} 张`
              : '保存待上传截图失败，请重试'
          )
        }
      }
    })

    const handleSetWatermark = async (value: boolean) => {
      const ctx = activeContext.current
      setWatermark(value)
      try {
        await savePatchSubmissionWatermark(ctx.submissionId, value)
      } catch (error) {
        console.error('Failed to persist submission watermark option', error)
      }
    }

    /** Uploading writes display_order, so the current sequence is synchronized
     * before the first file starts. */
    const uploadWithSynchronizedOrder = async (
      ctx: DraftContext,
      clientAssetIds: string[]
    ) => {
      if (ctx.uploadRunning || ctx.synchronizingOrder) return
      const synchronized = await flushGalleryOrder(ctx)
      if (!synchronized.ok) {
        if (isCurrent(ctx)) toast.error(synchronized.message)
        return
      }
      await uploadItems(ctx, clientAssetIds)
    }

    /** The switch is frozen into every targeted item before the first request,
     *  so an interrupted batch retries with the value the author chose. */
    const startUpload = async () => {
      const ctx = activeContext.current
      if (ctx.uploadRunning || ctx.synchronizingOrder) return
      const targets = ctx.items.filter(
        (item) => item.status === 'pending' || item.status === 'failed'
      )
      if (!targets.length) return

      const targetIds = new Set(targets.map((item) => item.clientAssetId))
      try {
        await persistDraft(ctx, ({ items }) => ({
          items: items.map((item) =>
            targetIds.has(item.clientAssetId) ? { ...item, watermark } : item
          )
        }))
      } catch (error) {
        console.error('Failed to persist submission watermark snapshot', error)
        if (isCurrent(ctx)) toast.error('保存水印设置失败，未开始上传')
        return
      }

      await uploadWithSynchronizedOrder(ctx, [...targetIds])
    }

    const removeLocalUpload = async (clientAssetId: string) => {
      const ctx = activeContext.current
      try {
        await persistDraft(ctx, ({ items }) => ({
          items: items.filter((item) => item.clientAssetId !== clientAssetId)
        }))
        releasePreview(clientAssetId)
      } catch (error) {
        console.error('Failed to remove submission upload draft item', error)
        if (isCurrent(ctx)) toast.error('移除待上传截图失败，请重试')
      }
    }

    const deleteImages = async (ctx: DraftContext, galleryIds: number[]) => {
      try {
        const response = await kunFetchDeleteBody<
          string | Record<string, never>
        >('/patch-submission/asset', {
          submissionId: ctx.submissionId,
          galleryIds
        })
        if (typeof response === 'string') {
          if (isCurrent(ctx)) toast.error(response)
          return false
        }
        const removed = new Set(galleryIds)
        updateContextGallery(ctx, (current) =>
          current.filter((image) => !removed.has(image.id))
        )
        return true
      } catch (error) {
        console.error('Failed to delete submission gallery images', error)
        if (isCurrent(ctx)) toast.error('删除截图失败，请检查网络后重试')
        return false
      }
    }

    const deleteImage = async (galleryId: number) => {
      const ctx = activeContext.current
      if ((await deleteImages(ctx, [galleryId])) && isCurrent(ctx)) {
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
      const ctx = activeContext.current
      setDeleting(true)
      try {
        if (
          selectedServerIds.length &&
          !(await deleteImages(ctx, selectedServerIds))
        ) {
          return
        }

        if (selectedLocalIds.length) {
          const removing = new Set(selectedLocalIds)
          try {
            await persistDraft(ctx, ({ items }) => ({
              items: items.filter((item) => !removing.has(item.clientAssetId))
            }))
            for (const clientAssetId of removing) releasePreview(clientAssetId)
          } catch (error) {
            console.error(
              'Failed to remove submission upload draft items',
              error
            )
            if (isCurrent(ctx)) toast.error('移除待上传截图失败，请重试')
            return
          }
        }

        if (isCurrent(ctx)) setSelected(new Set())
      } finally {
        if (isCurrent(ctx)) setDeleting(false)
      }
    }

    const setSelectedNSFW = async (isNSFW: boolean) => {
      const galleryIds = selectedReadyServerIds
      if (!galleryIds.length) return
      const ctx = activeContext.current
      setUpdatingNSFW(true)
      try {
        const response = await kunFetchPatch<string | Record<string, never>>(
          '/patch-submission/asset',
          { action: 'nsfw', submissionId: ctx.submissionId, galleryIds, isNSFW }
        )
        if (typeof response === 'string') {
          if (isCurrent(ctx)) toast.error(response)
          return
        }
        const updated = new Set(galleryIds)
        updateContextGallery(ctx, (current) =>
          current.map((image) =>
            updated.has(image.id) ? { ...image, isNSFW } : image
          )
        )
        if (isCurrent(ctx)) setSelected(new Set())
      } catch (error) {
        console.error('Failed to update submission gallery NSFW state', error)
        if (isCurrent(ctx)) {
          toast.error('截图分级更新失败，请检查网络后重试')
        }
      } finally {
        if (isCurrent(ctx)) setUpdatingNSFW(false)
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

    // The grid does not reorder until the drag ends, so the index the overlay
    // labels itself with is the one the card had when it was picked up.
    const activeDragIndex = activeDragKey
      ? entries.findIndex((entry) => entry.key === activeDragKey)
      : -1
    const activeDragEntry = activeDragIndex < 0 ? null : entries[activeDragIndex]

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
            color={
              progress.completed === progress.total ? 'success' : 'primary'
            }
          />
        )}

        {isBusy && (
          <p className="text-sm text-default-500">
            {synchronizingOrder ? '正在同步截图顺序' : '正在上传截图'}
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
            isDisabled={
              uploadableCount === 0 || synchronizingOrder || restoring
            }
            onPress={() => void startUpload()}
          >
            上传 {uploadableCount} 张截图
          </Button>
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
                    synchronizingOrder ||
                    restoring ||
                    (!selectedServerIds.length && !selectedLocalIds.length)
                  }
                  onPress={() => void deleteSelected()}
                >
                  删除选中 ({selectedServerIds.length + selectedLocalIds.length}
                  )
                </Button>
                <Button
                  size="sm"
                  color="warning"
                  variant="flat"
                  isLoading={updatingNSFW}
                  isDisabled={
                    synchronizingOrder ||
                    restoring ||
                    !selectedReadyServerIds.length
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
                    synchronizingOrder ||
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
              // Without a boundary the active card follows the pointer as far as
              // it is dragged, and the HeroUI Card around this section clips its
              // overflow — so a card dragged past the grid is simply cut off.
              // There is nothing outside the grid to drop onto either way.
              modifiers={[restrictToParentElement]}
              onDragStart={handleDragStart}
              onDragEnd={(event) => void handleDragEnd(event)}
              onDragCancel={() => setActiveDragKey(null)}
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
                                busy={synchronizingOrder || restoring}
                                onToggle={() => toggleSelection(entry.key)}
                                onOpenLightbox={() =>
                                  openLightboxFor(entry.key, openLightbox)
                                }
                                onDelete={() =>
                                  void deleteImage(entry.image!.id)
                                }
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
                                  void uploadWithSynchronizedOrder(
                                    activeContext.current,
                                    [entry.item!.clientAssetId]
                                  )
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
              {/* The copy that actually follows the pointer, and the only thing
                  dnd-kit can animate into the dropped slot. Purely visual: the
                  card it was cloned from keeps the focusable controls, so this
                  one is hidden from assistive technology and takes no pointer
                  events instead of duplicating them under the cursor. */}
              <DragOverlay dropAnimation={galleryDropAnimation}>
                {activeDragEntry ? (
                  <div aria-hidden className="pointer-events-none">
                    {activeDragEntry.image ? (
                      <SubmissionGalleryCard
                        image={activeDragEntry.image}
                        label={`第 ${activeDragIndex + 1} 张截图`}
                        selected={selected.has(activeDragEntry.key)}
                        editable={false}
                        busy
                        onToggle={() => undefined}
                        onOpenLightbox={() => undefined}
                        onDelete={() => undefined}
                      />
                    ) : (
                      <LocalUploadCard
                        item={activeDragEntry.item!}
                        editable={false}
                        selected={selected.has(activeDragEntry.key)}
                        busy
                        onToggle={() => undefined}
                        onOpenLightbox={() => undefined}
                        onRetry={() => undefined}
                        onRemove={() => undefined}
                      />
                    )}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        )}
      </div>
    )
  }
)
