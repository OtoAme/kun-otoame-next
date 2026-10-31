'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderPlus, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'

import {
  DashboardPage,
  DashboardPanel
} from '~/components/dashboard/page/DashboardPage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/dashboard/ui/dialog'
import { Input } from '~/components/dashboard/ui/input'
import { Label } from '~/components/dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Skeleton } from '~/components/dashboard/ui/skeleton'
import { Switch } from '~/components/dashboard/ui/switch'
import { Textarea } from '~/components/dashboard/ui/textarea'
import { useElementWidth } from '~/hooks/dashboard/useElementWidth'
import { cn } from '~/lib/dashboard/utils'
import {
  kunFetchDelete,
  kunFetchDeleteBody,
  kunFetchFormData,
  kunFetchGet,
  kunFetchPost,
  kunFetchPut
} from '~/utils/kunFetch'
import type {
  AdminStickerDeleteResult,
  AdminStickerPack,
  AdminStickerPackDeleteResult
} from '~/types/api/admin'

import { StickerPreview } from './StickerPreview'
import {
  STICKER_ACCEPT,
  STICKER_LIMITS,
  checkFiles,
  enableBlocker,
  formatSize,
  hasErrors,
  isValidSticker,
  stickerPreview,
  validatePack,
  type PackErrors,
  type PackFields
} from './stickerRules'

const AUTO_COVER = '__auto__'
const NEW_PACK = '__new__'
const EMPTY_FIELDS: PackFields = { slug: '', name: '', description: '' }

type Details = { name: string; description: string; coverStickerId: string }
type DeleteTarget =
  | { type: 'pack'; pack: AdminStickerPack }
  | { type: 'stickers'; ids: string[] }

const detailsOf = (pack: AdminStickerPack): Details => ({
  name: pack.name,
  description: pack.description,
  coverStickerId: pack.coverStickerId ?? ''
})

const replace = (packs: AdminStickerPack[], next: AdminStickerPack) =>
  packs.map((pack) => (pack.id === next.id ? next : pack))

function PackCover({ pack, size }: { pack: AdminStickerPack; size: string }) {
  return (
    <span className={cn('relative shrink-0', size)}>
      <StickerPreview
        src={pack.coverUrl}
        posterSrc={pack.coverUrl}
        mediaType="image"
        alt=""
        className="size-full rounded-md"
      />
      <span
        aria-hidden="true"
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card',
          pack.status === 1 ? 'bg-emerald-500' : 'bg-red-500'
        )}
      />
    </span>
  )
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}

function PackFieldsForm({
  idPrefix,
  fields,
  errors,
  onChange,
  disabled
}: {
  idPrefix: string
  fields: PackFields
  errors: PackErrors
  onChange: (field: keyof PackFields, value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-slug`}>英文标识</Label>
        <Input
          id={`${idPrefix}-slug`}
          value={fields.slug}
          placeholder="cute_cats"
          disabled={disabled}
          aria-invalid={Boolean(errors.slug)}
          onChange={(event) => onChange('slug', event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          小写 snake_case，创建后不能修改。
        </p>
        <FieldError message={errors.slug} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>展示名称</Label>
        <Input
          id={`${idPrefix}-name`}
          value={fields.name}
          disabled={disabled}
          aria-invalid={Boolean(errors.name)}
          onChange={(event) => onChange('name', event.target.value)}
        />
        <FieldError message={errors.name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>描述</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={fields.description}
          disabled={disabled}
          aria-invalid={Boolean(errors.description)}
          onChange={(event) => onChange('description', event.target.value)}
        />
        <FieldError message={errors.description} />
      </div>
    </div>
  )
}

export function DashboardStickers() {
  const [packs, setPacks] = useState<AdminStickerPack[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [details, setDetails] = useState<Details | null>(null)
  const [detailErrors, setDetailErrors] = useState<PackErrors>({})
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [pendingPackId, setPendingPackId] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createFields, setCreateFields] = useState(EMPTY_FIELDS)
  const [createErrors, setCreateErrors] = useState<PackErrors>({})

  const [importOpen, setImportOpen] = useState(false)
  const [importTarget, setImportTarget] = useState(NEW_PACK)
  const [importFields, setImportFields] = useState(EMPTY_FIELDS)
  const [importErrors, setImportErrors] = useState<PackErrors>({})
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [layoutRef, width] = useElementWidth<HTMLDivElement>()
  const inflight = useRef(false)

  const selected = packs?.find((pack) => pack.id === selectedId) ?? null
  const dirty = Boolean(
    selected &&
      details &&
      (details.name !== selected.name ||
        details.description !== selected.description ||
        details.coverStickerId !== (selected.coverStickerId ?? ''))
  )

  const activate = useCallback((pack: AdminStickerPack | null) => {
    setSelectedId(pack?.id ?? null)
    setDetails(pack ? detailsOf(pack) : null)
    setDetailErrors({})
    setChecked(new Set())
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const res = await kunFetchGet<{ packs: AdminStickerPack[] } | string>(
        '/admin/stickers'
      )
      if (typeof res === 'string') {
        setLoadError(res || '读取贴纸包失败')
        return
      }
      setPacks(res.packs)
      activate(res.packs[0] ?? null)
    } catch {
      setLoadError('网络错误，读取贴纸包失败')
    }
  }, [activate])

  useEffect(() => {
    void load()
  }, [load])

  // Warn before leaving the page with unsaved pack details.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Runs one mutation at a time; `label` names it for the busy state. */
  const run = async <T,>(
    label: string,
    request: () => Promise<T | string>,
    onOk: (result: T) => void,
    onError: (message: string) => void = (message) => toast.error(message)
  ) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(label)
    try {
      const result = await request()
      if (typeof result === 'string') onError(result || '操作失败，请稍后重试')
      else onOk(result)
    } catch {
      onError('网络错误，结果未知，请刷新后核对')
    } finally {
      inflight.current = false
      setBusy(null)
    }
  }

  const choosePack = (id: number) => {
    if (id === selectedId || !packs) return
    if (dirty) {
      setPendingPackId(id)
      return
    }
    activate(packs.find((pack) => pack.id === id) ?? null)
  }

  const saveDetails = () => {
    if (!selected || !details || !dirty) return
    const errors = validatePack({ slug: selected.slug, ...details }, false)
    setDetailErrors(errors)
    if (hasErrors(errors)) return
    void run(
      'save',
      () =>
        kunFetchPut<AdminStickerPack>('/admin/stickers/packs', {
          packId: selected.id,
          name: details.name,
          description: details.description,
          status: selected.status,
          coverStickerId: details.coverStickerId || null
        }),
      (pack) => {
        setPacks((current) => replace(current ?? [], pack))
        setDetails(detailsOf(pack))
        toast.success('Pack 已更新')
      }
    )
  }

  const togglePack = (enabled: boolean) => {
    if (!selected || dirty) return
    const status = enabled ? 1 : 0
    if (status === selected.status) return
    void run(
      'toggle',
      () =>
        kunFetchPut<AdminStickerPack>('/admin/stickers/packs', {
          packId: selected.id,
          name: selected.name,
          description: selected.description,
          status,
          coverStickerId: selected.coverStickerId
        }),
      (pack) => {
        setPacks((current) => replace(current ?? [], pack))
        setDetails(detailsOf(pack))
        toast.success(status === 1 ? 'Pack 已启用' : 'Pack 已禁用')
      }
    )
  }

  const setStickerStatus = (status: 0 | 1) => {
    if (!selected || !checked.size || dirty) return
    const stickerIds = [...checked]
    void run(
      'batch',
      () =>
        kunFetchPut<AdminStickerPack>('/admin/stickers/items', {
          stickerIds,
          status
        }),
      (pack) => {
        setPacks((current) => replace(current ?? [], pack))
        setDetails(detailsOf(pack))
        setChecked(new Set())
        toast.success(
          `已${status === 1 ? '启用' : '禁用'} ${stickerIds.length} 个 Sticker`
        )
      }
    )
  }

  const submitCreate = () => {
    const errors = validatePack(createFields, true)
    setCreateErrors(errors)
    if (hasErrors(errors)) return
    void run(
      'create',
      () =>
        kunFetchPost<AdminStickerPack>('/admin/stickers/packs', createFields),
      (pack) => {
        setPacks((current) => [...(current ?? []), pack])
        activate(pack)
        setCreateOpen(false)
        toast.success('Pack 已创建')
      }
    )
  }

  const openImport = (pack: AdminStickerPack | null) => {
    setImportTarget(pack ? String(pack.id) : NEW_PACK)
    setImportFields(EMPTY_FIELDS)
    setImportErrors({})
    setFiles([])
    setFileError('')
    if (fileInput.current) fileInput.current.value = ''
    setImportOpen(true)
  }

  const submitImport = () => {
    const isNew = importTarget === NEW_PACK
    const errors = isNew ? validatePack(importFields, true) : {}
    const filesProblem = checkFiles(files)
    setImportErrors(errors)
    setFileError(filesProblem)
    if (hasErrors(errors) || filesProblem) return
    const before =
      packs?.find((pack) => String(pack.id) === importTarget)?.stickers
        .length ?? 0
    const form = new FormData()
    if (isNew) {
      form.append('slug', importFields.slug)
      form.append('name', importFields.name)
      form.append('description', importFields.description)
    } else {
      form.append('packId', importTarget)
    }
    files.forEach((file) => form.append('files', file))
    void run(
      'import',
      () =>
        kunFetchFormData<AdminStickerPack>(
          '/admin/stickers/import',
          form,
          120_000
        ),
      (pack) => {
        setPacks((current) => {
          const list = current ?? []
          return list.some((item) => item.id === pack.id)
            ? replace(list, pack)
            : [...list, pack]
        })
        activate(pack)
        setImportOpen(false)
        toast.success(
          `已导入 ${Math.max(0, pack.stickers.length - before)} 个 Sticker`
        )
      },
      // Keep the dialog and the chosen files so the import can be retried.
      (message) => setFileError(message)
    )
  }

  const submitDelete = () => {
    if (!deleteTarget) return
    setDeleteError('')
    const warnCleanup = (title: string, failed: number) =>
      failed > 0
        ? toast(`${title}，${failed} 个对象存储文件未能清理，请稍后检查存储`, {
            icon: '⚠️'
          })
        : toast.success(title)
    if (deleteTarget.type === 'pack') {
      const target = deleteTarget.pack
      void run(
        'delete',
        () =>
          kunFetchDelete<AdminStickerPackDeleteResult>(
            '/admin/stickers/packs',
            { packId: target.id }
          ),
        (result) => {
          const rest = (packs ?? []).filter((pack) => pack.id !== result.packId)
          setPacks(rest)
          activate(rest[0] ?? null)
          setDeleteTarget(null)
          warnCleanup('Pack 已永久删除', result.objectCleanupFailed)
        },
        setDeleteError
      )
      return
    }
    const ids = deleteTarget.ids
    void run(
      'delete',
      () =>
        kunFetchDeleteBody<AdminStickerDeleteResult>('/admin/stickers/items', {
          stickerIds: ids
        }),
      (result) => {
        setPacks((current) => replace(current ?? [], result.pack))
        setDetails(detailsOf(result.pack))
        setChecked(new Set())
        setDeleteTarget(null)
        warnCleanup(
          `已永久删除 ${result.deletedCount} 个 Sticker`,
          result.objectCleanupFailed
        )
      },
      setDeleteError
    )
  }

  const twoColumn = width >= 900
  const toggleBlocker = selected
    ? dirty
      ? '请先保存或撤销当前更改'
      : enableBlocker(selected)
    : ''
  const deleteBlocker = selected
    ? selected.status === 1
      ? '请先禁用 Pack，再永久删除'
      : dirty
        ? '请先保存或撤销当前更改'
        : ''
    : ''
  const allChecked = Boolean(
    selected?.stickers.length &&
      selected.stickers.every((sticker) => checked.has(sticker.id))
  )

  const packList = (
    <DashboardPanel className="p-2">
      {packs === null ? (
        <div className="flex flex-col gap-2 p-2" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : packs.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          还没有贴纸包。新建一个，或直接导入贴纸时创建。
        </p>
      ) : (
        <ul aria-label="贴纸包列表" className="flex flex-col gap-1">
          {packs.map((pack) => (
            <li key={pack.id}>
              <button
                type="button"
                aria-current={pack.id === selectedId ? 'true' : undefined}
                onClick={() => choosePack(pack.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                  pack.id === selectedId && 'bg-accent'
                )}
              >
                <PackCover pack={pack} size="size-10" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {pack.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {pack.slug} · {pack.stickers.length} 张
                    {pack.status === 1 ? '' : ' · 已禁用'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  )

  const packDetail = selected && details && (
    <div className="flex min-w-0 flex-col gap-4">
      <DashboardPanel className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <PackCover pack={selected} size="size-14" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold">
              {selected.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {selected.slug}
              {selected.isBuiltin ? ' · 内置' : ''}
              {selected.price > 0 ? ` · ${selected.price} 萌萌点` : ' · 免费'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="sticker-pack-enabled" className="text-sm">
              {selected.status === 1 ? '已启用' : '已禁用'}
            </Label>
            <Switch
              id="sticker-pack-enabled"
              checked={selected.status === 1}
              disabled={Boolean(toggleBlocker) || busy !== null}
              title={toggleBlocker || undefined}
              onCheckedChange={togglePack}
            />
          </div>
        </div>
        {toggleBlocker && (
          <p className="text-xs text-muted-foreground">{toggleBlocker}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sticker-pack-name">展示名称</Label>
            <Input
              id="sticker-pack-name"
              value={details.name}
              aria-invalid={Boolean(detailErrors.name)}
              onChange={(event) =>
                setDetails({ ...details, name: event.target.value })
              }
            />
            <FieldError message={detailErrors.name} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sticker-pack-cover">封面</Label>
            <Select
              value={details.coverStickerId || AUTO_COVER}
              onValueChange={(value) =>
                setDetails({
                  ...details,
                  coverStickerId: value === AUTO_COVER ? '' : value
                })
              }
            >
              <SelectTrigger id="sticker-pack-cover" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_COVER}>自动选择</SelectItem>
                {selected.stickers.filter(isValidSticker).map((sticker) => (
                  <SelectItem key={sticker.id} value={sticker.id}>
                    {sticker.alt || sticker.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="sticker-pack-description">描述</Label>
            <Textarea
              id="sticker-pack-description"
              value={details.description}
              aria-invalid={Boolean(detailErrors.description)}
              onChange={(event) =>
                setDetails({ ...details, description: event.target.value })
              }
            />
            <FieldError message={detailErrors.description} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button onClick={saveDetails} disabled={!dirty || busy !== null}>
            {busy === 'save' && <Loader2 className="animate-spin" />}
            保存
          </Button>
          <Button
            variant="outline"
            disabled={!dirty || busy !== null}
            onClick={() => {
              setDetails(detailsOf(selected))
              setDetailErrors({})
            }}
          >
            撤销更改
          </Button>
          {dirty && (
            <span className="text-sm text-amber-700 dark:text-amber-400">
              有未保存的更改
            </span>
          )}
          <span className="flex-1" />
          <Button
            variant="outline"
            disabled={Boolean(deleteBlocker) || busy !== null}
            title={deleteBlocker || undefined}
            onClick={() => {
              setDeleteError('')
              setDeleteTarget({ type: 'pack', pack: selected })
            }}
          >
            <Trash2 />
            删除 Pack
          </Button>
        </div>
      </DashboardPanel>

      <DashboardPanel>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Checkbox
            id="sticker-select-all"
            checked={allChecked}
            disabled={!selected.stickers.length || dirty || busy !== null}
            onCheckedChange={(value) =>
              setChecked(
                value === true
                  ? new Set(selected.stickers.map((sticker) => sticker.id))
                  : new Set()
              )
            }
          />
          <Label htmlFor="sticker-select-all" className="text-sm font-normal">
            {checked.size > 0 ? `已选 ${checked.size} 张` : '全选'}
          </Label>
          {checked.size > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={dirty || busy !== null}
                onClick={() => setStickerStatus(1)}
              >
                启用
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={dirty || busy !== null}
                onClick={() => setStickerStatus(0)}
              >
                禁用
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(deleteBlocker) || busy !== null}
                title={deleteBlocker || undefined}
                onClick={() => {
                  setDeleteError('')
                  setDeleteTarget({ type: 'stickers', ids: [...checked] })
                }}
              >
                <Trash2 />
                删除
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button
            size="sm"
            disabled={dirty || busy !== null}
            onClick={() => openImport(selected)}
          >
            <Upload />
            导入到此 Pack
          </Button>
        </div>
        {dirty && (
          <p className="border-b px-3 py-2 text-xs text-muted-foreground">
            保存或撤销上方更改后才能操作贴纸。
          </p>
        )}
        {selected.stickers.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            这个 Pack 还没有贴纸，点「导入到此 Pack」添加。
          </p>
        ) : (
          <ul
            aria-label="贴纸"
            className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3 p-3"
          >
            {selected.stickers.map((sticker) => {
              const label = sticker.alt || sticker.id
              const isChecked = checked.has(sticker.id)
              return (
                <li key={sticker.id}>
                  <label
                    className={cn(
                      'relative flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2 hover:bg-accent/60',
                      isChecked && 'border-primary ring-1 ring-primary',
                      (dirty || busy !== null) &&
                        'cursor-not-allowed opacity-60'
                    )}
                  >
                    <Checkbox
                      aria-label={`选择 ${label}`}
                      className="absolute top-2 left-2 z-10 bg-background"
                      checked={isChecked}
                      disabled={dirty || busy !== null}
                      onCheckedChange={(value) =>
                        setChecked((current) => {
                          const next = new Set(current)
                          if (value === true) next.add(sticker.id)
                          else next.delete(sticker.id)
                          return next
                        })
                      }
                    />
                    <StickerPreview
                      src={sticker.assetUrl}
                      posterSrc={stickerPreview(sticker)}
                      mediaType={sticker.mediaType}
                      alt={label}
                      className="aspect-square w-full rounded-md"
                    />
                    <span className="truncate text-xs" title={label}>
                      {label}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Badge
                        variant="outline"
                        className={
                          sticker.status === 1
                            ? 'border-green-600/40 text-green-700 dark:text-green-400'
                            : ''
                        }
                      >
                        {sticker.status === 1 ? '启用' : '禁用'}
                      </Badge>
                      {selected.coverStickerId === sticker.id && (
                        <Badge variant="secondary">封面</Badge>
                      )}
                      {sticker.mediaType === 'video' && (
                        <Badge variant="secondary">动图</Badge>
                      )}
                      {!isValidSticker(sticker) && sticker.status === 1 && (
                        <Badge
                          variant="outline"
                          className="border-amber-600/40 text-amber-700 dark:text-amber-400"
                        >
                          文件不完整
                        </Badge>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </DashboardPanel>
    </div>
  )

  return (
    <DashboardPage
      title="贴纸"
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={dirty || busy !== null}
            onClick={() => {
              setCreateFields(EMPTY_FIELDS)
              setCreateErrors({})
              setCreateOpen(true)
            }}
          >
            <FolderPlus />
            新建 Pack
          </Button>
          <Button
            size="sm"
            disabled={dirty || busy !== null}
            onClick={() => openImport(null)}
          >
            <Upload />
            导入贴纸
          </Button>
        </>
      }
    >
      {loadError ? (
        <DashboardPanel className="flex flex-wrap items-center gap-3 p-4">
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </DashboardPanel>
      ) : (
        <div
          ref={layoutRef}
          className={cn(
            'grid min-w-0 items-start gap-4',
            twoColumn && 'grid-cols-[260px_minmax(0,1fr)]'
          )}
        >
          {packList}
          {packDetail}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (busy !== 'create') setCreateOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 Pack</DialogTitle>
            <DialogDescription>
              新建的 Pack 默认禁用，导入贴纸并检查后再启用。
            </DialogDescription>
          </DialogHeader>
          <PackFieldsForm
            idPrefix="sticker-create"
            fields={createFields}
            errors={createErrors}
            disabled={busy === 'create'}
            onChange={(field, value) => {
              setCreateFields({ ...createFields, [field]: value })
              setCreateErrors({ ...createErrors, [field]: undefined })
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy === 'create'}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button disabled={busy === 'create'} onClick={submitCreate}>
              {busy === 'create' && <Loader2 className="animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (busy !== 'import') setImportOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>导入贴纸</DialogTitle>
            <DialogDescription>
              WebP ≤ {formatSize(STICKER_LIMITS.staticBytes)}、VP9 WebM ≤{' '}
              {formatSize(STICKER_LIMITS.webmBytes)}、ZIP ≤{' '}
              {formatSize(STICKER_LIMITS.zipBytes)}；单次最多{' '}
              {STICKER_LIMITS.maxItems} 个文件，合计不超过{' '}
              {formatSize(STICKER_LIMITS.totalBytes)}
              。与已有贴纸重复的文件会被跳过。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sticker-import-target">目标 Pack</Label>
            <Select
              value={importTarget}
              onValueChange={setImportTarget}
              disabled={busy === 'import'}
            >
              <SelectTrigger id="sticker-import-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_PACK}>
                  新建 Pack（导入时创建）
                </SelectItem>
                {(packs ?? []).map((pack) => (
                  <SelectItem key={pack.id} value={String(pack.id)}>
                    {pack.name}（{pack.slug}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {importTarget === NEW_PACK && (
            <PackFieldsForm
              idPrefix="sticker-import"
              fields={importFields}
              errors={importErrors}
              disabled={busy === 'import'}
              onChange={(field, value) => {
                setImportFields({ ...importFields, [field]: value })
                setImportErrors({ ...importErrors, [field]: undefined })
              }}
            />
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="sticker-import-files">文件</Label>
            <Input
              id="sticker-import-files"
              ref={fileInput}
              type="file"
              multiple
              accept={STICKER_ACCEPT}
              disabled={busy === 'import'}
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? [])
                setFiles((current) => [...current, ...chosen])
                setFileError('')
                event.target.value = ''
              }}
            />
            {files.length > 0 && (
              <ul
                aria-label="已选文件"
                className="max-h-40 overflow-y-auto rounded-md border text-sm"
              >
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatSize(file.size)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`移除 ${file.name}`}
                      disabled={busy === 'import'}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <FieldError message={fileError} />
          </div>
          {busy === 'import' && (
            <p className="text-sm text-muted-foreground">
              正在处理文件，ZIP 较大时可能需要一两分钟，请不要关闭窗口。
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy === 'import'}
              onClick={() => setImportOpen(false)}
            >
              取消
            </Button>
            <Button disabled={busy === 'import'} onClick={submitImport}>
              {busy === 'import' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus />
              )}
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && busy !== 'delete') setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === 'pack'
                ? `永久删除 Pack「${deleteTarget.pack.name}」？`
                : `永久删除 ${deleteTarget?.ids.length ?? 0} 个 Sticker？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'pack'
                ? 'Pack 和其中全部贴纸会被删除，对象存储里的文件一并清理。'
                : '这些贴纸会被删除，对象存储里的文件一并清理。'}
              被历史消息引用的贴纸、已有用户拥有的 Pack
              不能删除，只能禁用；这类情况服务器会拒绝并说明原因。操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldError message={deleteError} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'delete'}>
              取消
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy === 'delete'}
              onClick={submitDelete}
            >
              {busy === 'delete' && <Loader2 className="animate-spin" />}
              永久删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingPackId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPackId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前 Pack 的名称、描述或封面改动尚未保存，切换后会丢失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                const pack = packs?.find((item) => item.id === pendingPackId)
                setPendingPackId(null)
                activate(pack ?? null)
              }}
            >
              放弃更改
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPage>
  )
}
