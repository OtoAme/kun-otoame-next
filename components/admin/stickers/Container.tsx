'use client'

import {
  addToast,
  Avatar,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Chip,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Listbox,
  ListboxItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
  Select,
  SelectItem,
  Switch,
  Tab,
  Tabs,
  Textarea,
  Tooltip,
  useDisclosure
} from '@heroui/react'
import { useRef, useState, type Key } from 'react'
import {
  kunFetchDelete,
  kunFetchDeleteBody,
  kunFetchFormData,
  kunFetchPost,
  kunFetchPut
} from '~/utils/kunFetch'
import {
  stickerPackDescriptionSchema,
  stickerPackNameSchema,
  stickerPackSlugSchema
} from '~/validations/sticker'
import { StickerThumbnail } from '~/components/sticker/StickerThumbnail'
import { PackStatusCover } from './PackStatusCover'
import type {
  AdminStickerDeleteResult,
  AdminStickerPack,
  AdminStickerPackDeleteResult
} from '~/types/api/admin'

interface Props {
  initialPacks: AdminStickerPack[]
}

type PackDetailsForm = {
  name: string
  description: string
  coverStickerId: string
}

type NewPackForm = {
  slug: string
  name: string
  description: string
}

type PackFormErrors = Partial<Record<keyof NewPackForm, string>>
type PackTab = 'settings' | 'stickers'
type DeleteTarget =
  | { type: 'pack'; pack: AdminStickerPack }
  | { type: 'stickers'; stickerIds: string[] }

const EMPTY_NEW_PACK: NewPackForm = { slug: '', name: '', description: '' }
const EMPTY_PACK_DETAILS: PackDetailsForm = {
  name: '',
  description: '',
  coverStickerId: ''
}
const AUTO_COVER_KEY = '__auto__'
const CREATE_PACK_KEY = '__create__'

const replacePack = (packs: AdminStickerPack[], updated: AdminStickerPack) =>
  packs.map((pack) => (pack.id === updated.id ? updated : pack))

const getStickerPreview = (sticker: AdminStickerPack['stickers'][number]) =>
  sticker.thumbnailUrl ??
  (sticker.mediaType === 'image' ? sticker.assetUrl : null)

const getPackDetails = (pack: AdminStickerPack): PackDetailsForm => ({
  name: pack.name,
  description: pack.description,
  coverStickerId: pack.coverStickerId ?? ''
})

const getFirstSelectedKey = (keys: 'all' | Iterable<Key>) => {
  if (keys === 'all') {
    return ''
  }
  const selected = Array.from(keys)[0]
  return selected === undefined ? '' : String(selected)
}

const getSchemaError = (
  schema:
    | typeof stickerPackSlugSchema
    | typeof stickerPackNameSchema
    | typeof stickerPackDescriptionSchema,
  value: string
) => {
  const parsed = schema.safeParse(value)
  return parsed.success ? undefined : parsed.error.issues[0]?.message
}

const validatePackForm = (
  form: NewPackForm,
  includeSlug: boolean
): PackFormErrors => ({
  ...(includeSlug
    ? { slug: getSchemaError(stickerPackSlugSchema, form.slug) }
    : {}),
  name: getSchemaError(stickerPackNameSchema, form.name),
  description: getSchemaError(stickerPackDescriptionSchema, form.description)
})

const hasFormErrors = (errors: PackFormErrors) =>
  Object.values(errors).some(Boolean)

const formatFileSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`

const notifySuccess = (title: string) =>
  addToast({
    title,
    color: 'success',
    severity: 'success',
    timeout: 4000
  })

const notifyError = (message: string) =>
  addToast({
    title: '操作失败',
    description: message,
    color: 'danger',
    severity: 'danger',
    timeout: 8000
  })

const notifyWarning = (title: string, description: string) =>
  addToast({
    title,
    description,
    color: 'warning',
    severity: 'warning',
    timeout: 8000
  })

const isValidAdminSticker = (sticker: AdminStickerPack['stickers'][number]) =>
  sticker.status === 1 &&
  sticker.assetKey.trim().length > 0 &&
  sticker.width > 0 &&
  sticker.height > 0 &&
  sticker.size > 0 &&
  (sticker.mediaType !== 'video' || Boolean(sticker.thumbnailKey))

const getPackEnableDisabledReason = (pack: AdminStickerPack) => {
  if (pack.status === 1) {
    return ''
  }

  const validStickers = pack.stickers.filter(isValidAdminSticker)
  if (!validStickers.length) {
    return 'Pack 至少需要一张有效 Sticker 才能启用'
  }
  if (
    pack.coverStickerId &&
    !validStickers.some((sticker) => sticker.id === pack.coverStickerId)
  ) {
    return '请先选择 Pack 内有效的封面 Sticker'
  }

  return ''
}

export const StickerAdmin = ({ initialPacks }: Props) => {
  const initialPack = initialPacks[0] ?? null
  const [packs, setPacks] = useState(initialPacks)
  const [selectedPackId, setSelectedPackId] = useState<number | null>(
    initialPack?.id ?? null
  )
  const [packForm, setPackForm] = useState<PackDetailsForm>(() =>
    initialPack ? getPackDetails(initialPack) : EMPTY_PACK_DETAILS
  )
  const [packErrors, setPackErrors] = useState<PackFormErrors>({})
  const [packTab, setPackTab] = useState<PackTab>('settings')
  const [selectedStickerIds, setSelectedStickerIds] = useState<Set<string>>(
    new Set()
  )
  const [pendingPackId, setPendingPackId] = useState<number | null>(null)

  const [createForm, setCreateForm] = useState<NewPackForm>(EMPTY_NEW_PACK)
  const [createErrors, setCreateErrors] = useState<PackFormErrors>({})

  const [uploadPackId, setUploadPackId] = useState('')
  const [uploadForm, setUploadForm] = useState<NewPackForm>(EMPTY_NEW_PACK)
  const [uploadErrors, setUploadErrors] = useState<PackFormErrors>({})
  const [uploadFileError, setUploadFileError] = useState('')
  const [files, setFiles] = useState<File[]>([])

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const [isSavingPack, setIsSavingPack] = useState(false)
  const [isTogglingPack, setIsTogglingPack] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    isOpen: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
    onOpenChange: onCreateOpenChange
  } = useDisclosure()
  const {
    isOpen: isUploadOpen,
    onOpen: onUploadOpen,
    onClose: onUploadClose,
    onOpenChange: onUploadOpenChange
  } = useDisclosure()
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
    onOpenChange: onDeleteOpenChange
  } = useDisclosure()
  const {
    isOpen: isDiscardOpen,
    onOpen: onDiscardOpen,
    onClose: onDiscardClose,
    onOpenChange: onDiscardOpenChange
  } = useDisclosure()

  const selectedPack = packs.find((pack) => pack.id === selectedPackId) ?? null
  const isPackDirty = Boolean(
    selectedPack &&
      (packForm.name !== selectedPack.name ||
        packForm.description !== selectedPack.description ||
        packForm.coverStickerId !== (selectedPack.coverStickerId ?? ''))
  )

  const activatePack = (pack: AdminStickerPack, tab: PackTab = 'settings') => {
    setSelectedPackId(pack.id)
    setPackForm(getPackDetails(pack))
    setPackErrors({})
    setSelectedStickerIds(new Set())
    setPackTab(tab)
  }

  const requestPackSelection = (packId: number) => {
    if (packId === selectedPackId) {
      return
    }
    const pack = packs.find((candidate) => candidate.id === packId)
    if (!pack) {
      return
    }
    if (isPackDirty) {
      setPendingPackId(packId)
      onDiscardOpen()
      return
    }
    activatePack(pack)
  }

  const confirmPackSelection = () => {
    const pack = packs.find((candidate) => candidate.id === pendingPackId)
    setPendingPackId(null)
    onDiscardClose()
    if (pack) {
      activatePack(pack)
    }
  }

  const resetPackChanges = () => {
    if (!selectedPack) {
      return
    }
    setPackForm(getPackDetails(selectedPack))
    setPackErrors({})
  }

  const updatePackField = <K extends keyof PackDetailsForm>(
    field: K,
    value: PackDetailsForm[K]
  ) => {
    setPackForm((current) => ({ ...current, [field]: value }))
    if (field !== 'coverStickerId') {
      setPackErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  const submitPackDetails = async () => {
    if (!selectedPack || !isPackDirty) {
      return
    }
    const errors = validatePackForm(
      {
        slug: selectedPack.slug,
        name: packForm.name,
        description: packForm.description
      },
      false
    )
    setPackErrors(errors)
    if (hasFormErrors(errors)) {
      setPackTab('settings')
      return
    }

    setIsSavingPack(true)
    try {
      const response = await kunFetchPut<AdminStickerPack | string>(
        '/admin/stickers/packs',
        {
          packId: selectedPack.id,
          name: packForm.name,
          description: packForm.description,
          status: selectedPack.status,
          coverStickerId: packForm.coverStickerId || null
        }
      )
      if (typeof response === 'string') {
        notifyError(response)
        return
      }

      setPacks((current) => replacePack(current, response))
      setPackForm(getPackDetails(response))
      setPackErrors({})
      notifySuccess('Pack 已更新')
    } catch {
      notifyError('更新 Pack 失败，请稍后重试')
    } finally {
      setIsSavingPack(false)
    }
  }

  const togglePack = async (isSelected: boolean) => {
    if (!selectedPack || isPackDirty) {
      return
    }
    const status = isSelected ? 1 : 0
    if (status === selectedPack.status) {
      return
    }

    setIsTogglingPack(true)
    try {
      const response = await kunFetchPut<AdminStickerPack | string>(
        '/admin/stickers/packs',
        {
          packId: selectedPack.id,
          name: selectedPack.name,
          description: selectedPack.description,
          status,
          coverStickerId: selectedPack.coverStickerId
        }
      )
      if (typeof response === 'string') {
        notifyError(response)
        return
      }

      setPacks((current) => replacePack(current, response))
      setPackForm(getPackDetails(response))
      notifySuccess(status === 1 ? 'Pack 已启用' : 'Pack 已禁用')
    } catch {
      notifyError(`${status === 1 ? '启用' : '禁用'} Pack 失败，请稍后重试`)
    } finally {
      setIsTogglingPack(false)
    }
  }

  const openCreate = () => {
    setCreateForm(EMPTY_NEW_PACK)
    setCreateErrors({})
    onCreateOpen()
  }

  const updateCreateField = <K extends keyof NewPackForm>(
    field: K,
    value: NewPackForm[K]
  ) => {
    setCreateForm((current) => ({ ...current, [field]: value }))
    setCreateErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submitCreate = async () => {
    const errors = validatePackForm(createForm, true)
    setCreateErrors(errors)
    if (hasFormErrors(errors)) {
      return
    }

    setIsCreating(true)
    try {
      const response = await kunFetchPost<AdminStickerPack | string>(
        '/admin/stickers/packs',
        createForm
      )
      if (typeof response === 'string') {
        notifyError(response)
        return
      }

      setPacks((current) => [...current, response])
      onCreateClose()
      activatePack(response, 'stickers')
      notifySuccess('Pack 已创建')
    } catch {
      notifyError('创建 Pack 失败，请稍后重试')
    } finally {
      setIsCreating(false)
    }
  }

  const openUpload = (pack: AdminStickerPack | null = selectedPack) => {
    setUploadPackId(pack ? String(pack.id) : '')
    setUploadForm(EMPTY_NEW_PACK)
    setUploadErrors({})
    setUploadFileError('')
    setFiles([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onUploadOpen()
  }

  const closeUpload = () => {
    if (isUploading) {
      return
    }
    setUploadFileError('')
    onUploadClose()
  }

  const updateUploadField = <K extends keyof NewPackForm>(
    field: K,
    value: NewPackForm[K]
  ) => {
    setUploadForm((current) => ({ ...current, [field]: value }))
    setUploadErrors((current) => ({ ...current, [field]: undefined }))
  }

  const removeUploadFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
    setUploadFileError('')
  }

  const submitUpload = async () => {
    const errors = uploadPackId ? {} : validatePackForm(uploadForm, true)
    const fileError = files.length ? '' : '请选择 WebP、WebM 或 ZIP 文件'
    setUploadErrors(errors)
    setUploadFileError(fileError)
    if (hasFormErrors(errors) || fileError) {
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      if (uploadPackId) {
        formData.append('packId', uploadPackId)
      } else {
        formData.append('slug', uploadForm.slug)
        formData.append('name', uploadForm.name)
        formData.append('description', uploadForm.description)
      }
      files.forEach((file) => formData.append('files', file))

      const previousPack = uploadPackId
        ? packs.find((pack) => pack.id === Number(uploadPackId))
        : null
      const response = await kunFetchFormData<AdminStickerPack | string>(
        '/admin/stickers/import',
        formData,
        120_000
      )
      if (typeof response === 'string') {
        setUploadFileError(response)
        return
      }

      const importedCount = Math.max(
        0,
        response.stickers.length - (previousPack?.stickers.length ?? 0)
      )
      setPacks((current) => {
        const exists = current.some((pack) => pack.id === response.id)
        return exists ? replacePack(current, response) : [...current, response]
      })
      onUploadClose()
      activatePack(response, 'stickers')
      notifySuccess(`已导入 ${importedCount} 个 Sticker`)
    } catch {
      const message = '导入 Sticker 失败，请重新选择文件后重试'
      setUploadFileError(message)
    } finally {
      setIsUploading(false)
    }
  }

  const toggleStickerSelection = (stickerId: string) => {
    if (isBatchSubmitting || isPackDirty) {
      return
    }
    setSelectedStickerIds((current) => {
      const next = new Set(current)
      if (next.has(stickerId)) {
        next.delete(stickerId)
      } else {
        next.add(stickerId)
      }
      return next
    })
  }

  const toggleAllStickers = (selected: boolean) => {
    if (!selectedPack || isPackDirty) {
      return
    }
    setSelectedStickerIds(
      selected
        ? new Set(selectedPack.stickers.map((sticker) => sticker.id))
        : new Set()
    )
  }

  const updateSelectedStickerStatus = async (status: number) => {
    if (!selectedPack || selectedStickerIds.size === 0 || isPackDirty) {
      return
    }

    const stickerIds = [...selectedStickerIds]
    setIsBatchSubmitting(true)
    try {
      const response = await kunFetchPut<AdminStickerPack | string>(
        '/admin/stickers/items',
        { stickerIds, status }
      )
      if (typeof response === 'string') {
        notifyError(response)
        return
      }

      setPacks((current) => replacePack(current, response))
      setPackForm(getPackDetails(response))
      setSelectedStickerIds(new Set())
      notifySuccess(
        `已${status === 1 ? '启用' : '禁用'} ${stickerIds.length} 个 Sticker`
      )
    } catch {
      notifyError(`${status === 1 ? '启用' : '禁用'} Sticker 失败，请稍后重试`)
    } finally {
      setIsBatchSubmitting(false)
    }
  }

  const openPackDelete = () => {
    if (!selectedPack || selectedPack.status === 1 || isPackDirty) {
      return
    }
    setDeleteTarget({ type: 'pack', pack: selectedPack })
    setDeleteError('')
    onDeleteOpen()
  }

  const openStickerDelete = () => {
    if (
      !selectedPack ||
      selectedPack.status === 1 ||
      selectedStickerIds.size === 0 ||
      isPackDirty
    ) {
      return
    }
    setDeleteTarget({
      type: 'stickers',
      stickerIds: [...selectedStickerIds]
    })
    setDeleteError('')
    onDeleteOpen()
  }

  const closeDelete = () => {
    if (isDeleting) {
      return
    }
    setDeleteTarget(null)
    setDeleteError('')
    onDeleteClose()
  }

  const submitDelete = async () => {
    if (!deleteTarget) {
      return
    }

    setIsDeleting(true)
    setDeleteError('')
    try {
      if (deleteTarget.type === 'pack') {
        const response = await kunFetchDelete<
          AdminStickerPackDeleteResult | string
        >('/admin/stickers/packs', { packId: deleteTarget.pack.id })
        if (typeof response === 'string') {
          setDeleteError(response)
          return
        }

        const remainingPacks = packs.filter(
          (pack) => pack.id !== response.packId
        )
        setPacks(remainingPacks)
        const nextPack = remainingPacks[0] ?? null
        if (nextPack) {
          activatePack(nextPack)
        } else {
          setSelectedPackId(null)
          setPackForm(EMPTY_PACK_DETAILS)
          setSelectedStickerIds(new Set())
        }
        setDeleteTarget(null)
        onDeleteClose()
        if (response.objectCleanupFailed > 0) {
          notifyWarning(
            'Pack 已删除',
            `${response.objectCleanupFailed} 个对象存储资源清理失败，请稍后检查存储状态`
          )
        } else {
          notifySuccess('Pack 已永久删除')
        }
        return
      }

      const response = await kunFetchDeleteBody<
        AdminStickerDeleteResult | string
      >('/admin/stickers/items', {
        stickerIds: deleteTarget.stickerIds
      })
      if (typeof response === 'string') {
        setDeleteError(response)
        return
      }

      setPacks((current) => replacePack(current, response.pack))
      setPackForm(getPackDetails(response.pack))
      setSelectedStickerIds(new Set())
      setDeleteTarget(null)
      onDeleteClose()
      if (response.objectCleanupFailed > 0) {
        notifyWarning(
          'Sticker 已删除',
          `${response.objectCleanupFailed} 个对象存储资源清理失败，请稍后检查存储状态`
        )
      } else {
        notifySuccess(`已永久删除 ${response.deletedCount} 个 Sticker`)
      }
    } catch {
      const message = '删除失败，请稍后重试'
      setDeleteError(message)
    } finally {
      setIsDeleting(false)
    }
  }

  const coverOptions = [
    { id: AUTO_COVER_KEY, label: '自动选择', preview: null },
    ...(selectedPack?.stickers.filter(isValidAdminSticker).map((sticker) => ({
      id: String(sticker.id),
      label: sticker.alt || sticker.id,
      preview: getStickerPreview(sticker)
    })) ?? [])
  ]

  const uploadPackOptions = [
    {
      id: CREATE_PACK_KEY,
      label: '新建 Pack',
      description: '导入时创建',
      preview: null
    },
    ...packs.map((pack) => ({
      id: String(pack.id),
      label: pack.name,
      description: pack.slug,
      preview: pack.coverUrl
    }))
  ]

  const selectedStickerCount = selectedStickerIds.size
  const isAllStickersSelected = Boolean(
    selectedPack?.stickers.length &&
      selectedPack.stickers.every((sticker) =>
        selectedStickerIds.has(sticker.id)
      )
  )
  const deletePackDisabledReason = selectedPack
    ? selectedPack.status === 1
      ? '请先禁用 Pack，再永久删除'
      : isPackDirty
        ? '请先保存或撤销当前更改'
        : ''
    : ''
  const deleteStickerDisabledReason = selectedPack
    ? selectedPack.status === 1
      ? '请先禁用 Pack，再永久删除 Sticker'
      : isPackDirty
        ? '请先保存或撤销当前更改'
        : ''
    : ''
  const packToggleDisabledReason = selectedPack
    ? isPackDirty
      ? '请先保存或撤销当前更改'
      : getPackEnableDisabledReason(selectedPack)
    : ''

  const packSelectorItems = packs.map((pack) => {
    const activeStickerCount = pack.stickers.filter(isValidAdminSticker).length
    return {
      ...pack,
      summary: `${pack.slug} · ${activeStickerCount}/${pack.stickers.length}`
    }
  })

  const packSettings = selectedPack ? (
    <div className="grid gap-4 md:grid-cols-2">
      <Input isReadOnly label="英文标识" value={selectedPack.slug} />
      <Input
        isRequired
        label="展示名称"
        value={packForm.name}
        isInvalid={Boolean(packErrors.name)}
        errorMessage={packErrors.name}
        onValueChange={(value) => updatePackField('name', value)}
      />
      <Textarea
        className="md:col-span-2"
        label="描述"
        minRows={2}
        value={packForm.description}
        isInvalid={Boolean(packErrors.description)}
        errorMessage={packErrors.description}
        onValueChange={(value) => updatePackField('description', value)}
      />
      <Select
        id="admin-sticker-pack-cover"
        className="md:col-span-2"
        label="封面"
        items={coverOptions}
        selectedKeys={[packForm.coverStickerId || AUTO_COVER_KEY]}
        renderValue={(items) =>
          items.map((item) => {
            const option = coverOptions.find(
              (candidate) => candidate.id === String(item.key)
            )
            return option ? (
              <div key={option.id} className="flex items-center gap-2">
                {option.preview && (
                  <Avatar
                    radius="sm"
                    size="sm"
                    src={option.preview}
                    name={option.label.slice(0, 1)}
                    classNames={{ img: 'object-contain' }}
                  />
                )}
                <span>{option.label}</span>
              </div>
            ) : null
          })
        }
        onSelectionChange={(keys) => {
          const selectedKey = getFirstSelectedKey(keys)
          updatePackField(
            'coverStickerId',
            selectedKey === AUTO_COVER_KEY ? '' : selectedKey
          )
        }}
      >
        {(option) => (
          <SelectItem key={option.id} textValue={option.label}>
            <div className="flex items-center gap-3">
              {option.preview && (
                <Avatar
                  radius="sm"
                  size="sm"
                  src={option.preview}
                  name={option.label.slice(0, 1)}
                  classNames={{ img: 'object-contain' }}
                />
              )}
              <span className={option.preview ? undefined : 'pl-11'}>
                {option.label}
              </span>
            </div>
          </SelectItem>
        )}
      </Select>
      <div className="md:col-span-2 pt-2">
        <Tooltip
          content={deletePackDisabledReason}
          isDisabled={!deletePackDisabledReason}
        >
          <span className="inline-flex">
            <Button
              color="danger"
              variant="light"
              isDisabled={Boolean(deletePackDisabledReason)}
              onPress={openPackDelete}
            >
              删除 Pack
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  ) : null

  const stickerManager = selectedPack ? (
    <div className="space-y-4">
      <div
        role="toolbar"
        aria-label="Sticker 批量操作"
        className="sticky top-2 z-20 -mx-1 flex min-h-8 flex-wrap items-center justify-between gap-2 rounded-medium bg-content1/95 px-1 py-2 backdrop-blur-sm"
      >
        <Checkbox
          size="sm"
          isSelected={isAllStickersSelected}
          isIndeterminate={selectedStickerCount > 0 && !isAllStickersSelected}
          isDisabled={
            !selectedPack.stickers.length || isBatchSubmitting || isPackDirty
          }
          onValueChange={toggleAllStickers}
        >
          {selectedStickerCount > 0 ? `已选 ${selectedStickerCount}` : '全选'}
        </Checkbox>
        {selectedStickerCount > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="flat"
              isDisabled={isBatchSubmitting || isPackDirty}
              onPress={() => updateSelectedStickerStatus(1)}
            >
              启用
            </Button>
            <Button
              size="sm"
              variant="flat"
              isDisabled={isBatchSubmitting || isPackDirty}
              onPress={() => updateSelectedStickerStatus(0)}
            >
              禁用
            </Button>
            <Tooltip
              content={deleteStickerDisabledReason}
              isDisabled={!deleteStickerDisabledReason}
            >
              <span className="inline-flex">
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  isDisabled={
                    isBatchSubmitting || Boolean(deleteStickerDisabledReason)
                  }
                  onPress={openStickerDelete}
                >
                  删除
                </Button>
              </span>
            </Tooltip>
          </div>
        ) : (
          <Button
            size="sm"
            color="primary"
            variant="flat"
            isDisabled={isPackDirty}
            onPress={() => openUpload(selectedPack)}
          >
            添加 Sticker
          </Button>
        )}
      </div>

      {selectedPack.stickers.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {selectedPack.stickers.map((sticker) => {
            const label = sticker.alt || sticker.id
            const isSelected = selectedStickerIds.has(sticker.id)
            return (
              <Card
                key={sticker.id}
                isPressable
                shadow="none"
                aria-label={`选择 ${label}`}
                aria-pressed={isSelected}
                isDisabled={isBatchSubmitting || isPackDirty}
                className={
                  isSelected
                    ? 'border border-primary ring-1 ring-primary'
                    : 'border border-default-200'
                }
                onPress={() => toggleStickerSelection(sticker.id)}
              >
                <CardBody className="relative flex aspect-square items-center justify-center overflow-hidden bg-default-100 p-1">
                  {sticker.assetUrl || sticker.thumbnailUrl ? (
                    <StickerThumbnail
                      src={sticker.assetUrl}
                      posterSrc={sticker.thumbnailUrl}
                      mediaType={sticker.mediaType}
                      mime={sticker.mime}
                      alt={label}
                      className="size-full"
                    />
                  ) : (
                    <Chip size="sm" color="warning" variant="flat">
                      不可用
                    </Chip>
                  )}
                  {selectedPack.coverStickerId === sticker.id && (
                    <Chip
                      size="sm"
                      color="primary"
                      variant="solid"
                      className="absolute left-1 top-1 h-5 px-1 text-[9px]"
                    >
                      封面
                    </Chip>
                  )}
                </CardBody>
                <CardFooter className="gap-2 px-2 py-1.5">
                  <p className="min-w-0 flex-1 truncate text-xs" title={label}>
                    {label}
                  </p>
                  <Chip
                    size="sm"
                    color={sticker.status === 1 ? 'success' : 'default'}
                    variant="flat"
                    className="h-5 px-1 text-[9px]"
                  >
                    {sticker.status === 1 ? '启用' : '禁用'}
                  </Chip>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card shadow="none" className="border border-default-200">
          <CardBody className="py-12 text-center text-sm text-default-500">
            暂无 Sticker
          </CardBody>
        </Card>
      )}
    </div>
  ) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Sticker 管理</h1>
        <Dropdown>
          <DropdownTrigger>
            <Button color="primary" isDisabled={isPackDirty}>
              添加
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label="添加 Sticker 内容">
            <DropdownItem key="create" onPress={openCreate}>
              新建 Pack
            </DropdownItem>
            <DropdownItem key="import" onPress={() => openUpload()}>
              导入 Sticker
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>

      {packs.length ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[6rem_minmax(0,1fr)]">
          <Select
            id="admin-sticker-pack-selector"
            className="lg:hidden"
            label="Sticker Pack"
            items={packSelectorItems}
            selectedKeys={selectedPackId ? [String(selectedPackId)] : []}
            renderValue={(items) =>
              items.map((item) => {
                const pack = packSelectorItems.find(
                  (candidate) => candidate.id === Number(item.key)
                )
                return pack ? (
                  <div
                    key={pack.id}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <PackStatusCover
                      compact
                      name={pack.name}
                      coverUrl={pack.coverUrl}
                      isEnabled={pack.status === 1}
                    />
                    <span className="truncate">{pack.name}</span>
                  </div>
                ) : null
              })
            }
            onSelectionChange={(keys) => {
              const key = getFirstSelectedKey(keys)
              if (key) {
                requestPackSelection(Number(key))
              }
            }}
          >
            {(pack) => (
              <SelectItem key={String(pack.id)} textValue={pack.name}>
                <div className="flex items-center gap-3">
                  <PackStatusCover
                    compact
                    name={pack.name}
                    coverUrl={pack.coverUrl}
                    isEnabled={pack.status === 1}
                  />
                  <div className="min-w-0">
                    <p className="truncate">{pack.name}</p>
                    <p className="truncate text-xs text-default-400">
                      {pack.summary}
                    </p>
                  </div>
                </div>
              </SelectItem>
            )}
          </Select>

          <Card
            as="aside"
            aria-label="Sticker Pack 列表"
            className="hidden h-full max-h-[calc(100dvh-2rem)] lg:sticky lg:top-4 lg:block"
            shadow="sm"
          >
            <CardBody className="h-full p-2">
              <ScrollShadow
                hideScrollBar
                className="h-full max-h-[calc(100dvh-3rem)]"
              >
                <Listbox
                  aria-label="Sticker Pack"
                  items={packSelectorItems}
                  color="primary"
                  variant="flat"
                  classNames={{
                    base: 'h-full',
                    list: 'flex h-full min-h-full w-full flex-col items-center justify-start'
                  }}
                  selectionMode="single"
                  disallowEmptySelection
                  hideSelectedIcon
                  selectedKeys={
                    selectedPackId
                      ? new Set([String(selectedPackId)])
                      : new Set()
                  }
                  onSelectionChange={(keys) => {
                    const key = getFirstSelectedKey(keys)
                    if (key) {
                      requestPackSelection(Number(key))
                    }
                  }}
                >
                  {(pack) => (
                    <ListboxItem
                      key={String(pack.id)}
                      textValue={pack.name}
                      aria-label={`${pack.name}，${
                        pack.status === 1 ? '已启用' : '已禁用'
                      }`}
                      classNames={{
                        base: 'mx-auto flex h-20 shrink-0 items-center justify-center px-1.5 py-2 data-[selected=true]:bg-primary/25 data-[selected=true]:data-[hover=true]:bg-primary/30',
                        title: 'hidden',
                        wrapper: 'hidden'
                      }}
                      startContent={
                        <Tooltip content={pack.name} placement="right">
                          <PackStatusCover
                            name={pack.name}
                            coverUrl={pack.coverUrl}
                            isEnabled={pack.status === 1}
                          />
                        </Tooltip>
                      }
                    />
                  )}
                </Listbox>
              </ScrollShadow>
            </CardBody>
          </Card>

          {selectedPack && (
            <Card className="min-w-0" shadow="sm">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">
                    {selectedPack.name}
                  </h2>
                  <p className="truncate font-mono text-xs text-default-400">
                    {selectedPack.slug}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isPackDirty && (
                    <>
                      <Chip size="sm" color="warning" variant="flat">
                        未保存
                      </Chip>
                      <Button
                        size="sm"
                        variant="light"
                        isDisabled={isSavingPack}
                        onPress={resetPackChanges}
                      >
                        撤销
                      </Button>
                      <Button
                        size="sm"
                        color="primary"
                        isLoading={isSavingPack}
                        onPress={submitPackDetails}
                      >
                        保存
                      </Button>
                    </>
                  )}
                  <Tooltip
                    content={packToggleDisabledReason}
                    isDisabled={!packToggleDisabledReason}
                  >
                    <span className="inline-flex">
                      <Switch
                        size="sm"
                        color="success"
                        aria-label="Pack 启用状态"
                        isSelected={selectedPack.status === 1}
                        isDisabled={
                          isTogglingPack || Boolean(packToggleDisabledReason)
                        }
                        onValueChange={togglePack}
                      />
                    </span>
                  </Tooltip>
                </div>
              </CardHeader>
              <Divider />
              <CardBody className="p-0">
                <Tabs
                  aria-label="Sticker Pack 管理"
                  variant="underlined"
                  selectedKey={packTab}
                  onSelectionChange={(key) => setPackTab(key as PackTab)}
                  classNames={{
                    tabList: 'px-5 pt-2',
                    panel: 'p-5'
                  }}
                >
                  <Tab key="settings" title="设置">
                    {packSettings}
                  </Tab>
                  <Tab
                    key="stickers"
                    title={`Sticker ${selectedPack.stickers.length}`}
                  >
                    {stickerManager}
                  </Tab>
                </Tabs>
              </CardBody>
            </Card>
          )}
        </div>
      ) : (
        <Card shadow="sm">
          <CardBody className="py-16 text-center text-sm text-default-500">
            暂无 Sticker Pack
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={isCreateOpen}
        onOpenChange={onCreateOpenChange}
        placement="center"
        size="lg"
        isDismissable={!isCreating}
        isKeyboardDismissDisabled={isCreating}
      >
        <ModalContent>
          <ModalHeader>新建 Pack</ModalHeader>
          <ModalBody className="grid gap-4 sm:grid-cols-2">
            <Input
              isRequired
              label="英文标识"
              placeholder="cute_cats"
              value={createForm.slug}
              isInvalid={Boolean(createErrors.slug)}
              errorMessage={createErrors.slug}
              onValueChange={(value) => updateCreateField('slug', value)}
            />
            <Input
              isRequired
              label="展示名称"
              value={createForm.name}
              isInvalid={Boolean(createErrors.name)}
              errorMessage={createErrors.name}
              onValueChange={(value) => updateCreateField('name', value)}
            />
            <Textarea
              className="sm:col-span-2"
              label="描述"
              minRows={2}
              value={createForm.description}
              isInvalid={Boolean(createErrors.description)}
              errorMessage={createErrors.description}
              onValueChange={(value) => updateCreateField('description', value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={isCreating}
              onPress={onCreateClose}
            >
              取消
            </Button>
            <Button
              color="primary"
              isLoading={isCreating}
              onPress={submitCreate}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isUploadOpen}
        onOpenChange={onUploadOpenChange}
        placement="center"
        size="lg"
        scrollBehavior="inside"
        isDismissable={!isUploading}
        isKeyboardDismissDisabled={isUploading}
      >
        <ModalContent>
          <ModalHeader>导入 Sticker</ModalHeader>
          <ModalBody className="gap-4">
            <Select
              id="admin-sticker-import-target-pack"
              label="目标 Pack"
              items={uploadPackOptions}
              selectedKeys={[uploadPackId || CREATE_PACK_KEY]}
              renderValue={(items) =>
                items.map((item) => {
                  const option = uploadPackOptions.find(
                    (candidate) => candidate.id === String(item.key)
                  )
                  return option ? (
                    <div key={option.id} className="flex items-center gap-2">
                      {option.preview && (
                        <Avatar
                          radius="sm"
                          size="sm"
                          src={option.preview}
                          name={option.label.slice(0, 1)}
                          classNames={{ img: 'object-contain' }}
                        />
                      )}
                      <span>{option.label}</span>
                    </div>
                  ) : null
                })
              }
              onSelectionChange={(keys) => {
                const selectedKey = getFirstSelectedKey(keys)
                setUploadPackId(
                  selectedKey === CREATE_PACK_KEY ? '' : selectedKey
                )
                setUploadFileError('')
              }}
            >
              {(option) => (
                <SelectItem key={option.id} textValue={option.label}>
                  <div className="flex items-center gap-3">
                    {option.preview && (
                      <Avatar
                        radius="sm"
                        size="sm"
                        src={option.preview}
                        name={option.label.slice(0, 1)}
                        classNames={{ img: 'object-contain' }}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate">{option.label}</p>
                      <p className="truncate text-xs text-default-400">
                        {option.description}
                      </p>
                    </div>
                  </div>
                </SelectItem>
              )}
            </Select>

            {!uploadPackId && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  isRequired
                  label="英文标识"
                  placeholder="cute_cats"
                  value={uploadForm.slug}
                  isInvalid={Boolean(uploadErrors.slug)}
                  errorMessage={uploadErrors.slug}
                  onValueChange={(value) => updateUploadField('slug', value)}
                />
                <Input
                  isRequired
                  label="展示名称"
                  value={uploadForm.name}
                  isInvalid={Boolean(uploadErrors.name)}
                  errorMessage={uploadErrors.name}
                  onValueChange={(value) => updateUploadField('name', value)}
                />
                <Textarea
                  className="sm:col-span-2"
                  label="描述"
                  minRows={2}
                  value={uploadForm.description}
                  isInvalid={Boolean(uploadErrors.description)}
                  errorMessage={uploadErrors.description}
                  onValueChange={(value) =>
                    updateUploadField('description', value)
                  }
                />
              </div>
            )}

            <Input
              ref={fileInputRef}
              isRequired
              type="file"
              label="文件"
              description="WebP ≤ 512 KB、VP9 WebM ≤ 300 KB、ZIP ≤ 32 MB"
              multiple
              accept=".webp,.webm,.zip,image/webp,video/webm,application/zip"
              isInvalid={Boolean(uploadFileError)}
              errorMessage={
                uploadFileError ? (
                  <span className="whitespace-pre-line">{uploadFileError}</span>
                ) : undefined
              }
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []))
                setUploadFileError('')
              }}
            />

            {files.length > 0 && (
              <div
                className="flex min-w-0 flex-wrap gap-2"
                aria-label="已选文件"
              >
                {files.map((file, index) => (
                  <Chip
                    key={`${file.name}-${file.size}-${index}`}
                    variant="flat"
                    className="max-w-full"
                    classNames={{ content: 'truncate' }}
                    title={`${file.name} · ${formatFileSize(file.size)}`}
                    onClose={() => removeUploadFile(index)}
                  >
                    {file.name} · {formatFileSize(file.size)}
                  </Chip>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={isUploading}
              onPress={closeUpload}
            >
              取消
            </Button>
            <Button
              color="primary"
              isLoading={isUploading}
              onPress={submitUpload}
            >
              导入
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isDeleteOpen}
        onOpenChange={onDeleteOpenChange}
        placement="center"
        size="sm"
        isDismissable={!isDeleting}
        isKeyboardDismissDisabled={isDeleting}
      >
        <ModalContent>
          <ModalHeader>
            {deleteTarget?.type === 'pack'
              ? `删除 ${deleteTarget.pack.name}`
              : `删除 ${deleteTarget?.stickerIds.length ?? 0} 个 Sticker`}
          </ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-default-500">
              将同时删除数据库记录和对象存储资源；存在历史消息引用
              {deleteTarget?.type === 'pack' ? '或用户所有权记录' : ''}
              时不会执行。
            </p>
            {deleteError && (
              <Card
                shadow="none"
                className="border border-danger-200 bg-danger-50"
              >
                <CardBody className="py-2 text-sm text-danger" role="alert">
                  {deleteError}
                </CardBody>
              </Card>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              isDisabled={isDeleting}
              onPress={closeDelete}
            >
              取消
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={submitDelete}
            >
              永久删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isDiscardOpen}
        onOpenChange={onDiscardOpenChange}
        placement="center"
        size="sm"
      >
        <ModalContent>
          <ModalHeader>放弃未保存的更改？</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">
              当前 Pack 的名称、描述或封面尚未保存。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                setPendingPackId(null)
                onDiscardClose()
              }}
            >
              继续编辑
            </Button>
            <Button color="danger" onPress={confirmPackSelection}>
              放弃更改
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
