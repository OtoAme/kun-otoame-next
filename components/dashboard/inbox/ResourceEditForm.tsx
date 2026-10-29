'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '~/components/dashboard/ui/button'
import { Input } from '~/components/dashboard/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  EditableLinkFields,
  FieldHint,
  fieldErrorDomId,
  fieldMessage,
  type EditableDraft,
  type FieldError
} from '~/components/dashboard/workspace/WorkspaceResourceEditor'
import { WorkspaceMultiSelect } from '~/components/dashboard/workspace/WorkspaceMultiSelect'
import { WorkspaceUserProvider } from '~/components/dashboard/workspace/WorkspaceUserContext'
import {
  getAllowedPlatformsBySectionAndTypes,
  normalizeTypesBySection,
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_SECTION,
  type ResourceSection
} from '~/constants/resource'
import {
  applyTypeChange,
  getChineseSupportOptions,
  getDefaultLinkStorage,
  getResourceTypeGroups,
  isChineseSupportType,
  splitTypesByChineseSupport
} from '~/utils/resourceFormRules'
import { kunFetchPut } from '~/utils/kunFetch'
import { patchResourceStableEditFormSchema } from '~/validations/patch'
import { workspaceValidationFeedback } from '~/validations/workspaceFeedback'
import type { AdminResource } from '~/types/api/admin'
import type { PatchResourceStableUpdateResponse } from '~/types/api/patch'

interface Draft {
  name: string
  section: ResourceSection
  note: string
  type: string[]
  language: string[]
  platform: string[]
  links: EditableDraft[]
}

const fieldClass = 'min-w-0 max-w-full break-all [overflow-wrap:anywhere]'

const toSection = (value: string): ResourceSection =>
  SUPPORTED_RESOURCE_SECTION.includes(value as ResourceSection)
    ? (value as ResourceSection)
    : 'galgame'

export const draftFromResource = (resource: AdminResource): Draft => ({
  name: resource.name,
  section: toSection(resource.section),
  note: resource.note,
  type: [...resource.type],
  language: [...resource.language],
  platform: [...resource.platform],
  links: resource.links.map((link) => ({
    key: `link-${link.id}`,
    protected: false,
    id: link.id,
    storage: link.storage,
    content: link.content ?? '',
    code: link.code ?? '',
    password: link.password ?? '',
    hash: link.hash ?? '',
    size: link.size
  }))
})

const requestBody = (resource: AdminResource, draft: Draft) => ({
  resourceId: resource.id,
  patchId: resource.patchId,
  baseLinks: resource.baseLinks ?? [],
  name: draft.name,
  section: draft.section,
  note: draft.note,
  type: draft.type,
  language: draft.language,
  platform: draft.platform,
  links: draft.links.map((link) => ({
    ...(link.id ? { id: link.id } : {}),
    storage: link.storage,
    content: link.content,
    code: link.code,
    password: link.password,
    hash: link.hash,
    size: link.size,
    ...(link.uploadId ? { uploadId: link.uploadId } : {})
  }))
})

/** Server response is definite only when it names this resource and its links. */
const isDefiniteSave = (
  response: unknown,
  resourceId: number
): response is PatchResourceStableUpdateResponse => {
  if (!response || typeof response !== 'object') return false
  const body = response as { id?: unknown; links?: unknown }
  return body.id === resourceId && Array.isArray(body.links)
}

/**
 * In-console editor for a pending resource. It writes through the admin
 * resource update (the same route the legacy review page uses), so link
 * version checks, the uploader notification and the audit log are unchanged.
 * Saving does not change the review status; approval stays a separate step.
 */
export function ResourceEditForm({
  resource,
  reviewerId,
  reviewerRole,
  onSaved,
  onCancel,
  isPhone = false
}: {
  isPhone?: boolean
  resource: AdminResource
  reviewerId: number
  reviewerRole: number
  onSaved: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromResource(resource))
  const [initial] = useState(() =>
    JSON.stringify(requestBody(resource, draftFromResource(resource)))
  )
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingKeys, setUploadingKeys] = useState<ReadonlySet<string>>(
    new Set()
  )
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // Set by a failed validation; the next render scrolls its message into view
  // because the field may sit below the visible part of the form.
  const scrollToError = useRef('')

  useEffect(() => {
    const path = scrollToError.current
    if (!path) return
    scrollToError.current = ''
    document
      .getElementById(fieldErrorDomId(path))
      ?.scrollIntoView?.({ block: 'center' })
  }, [fieldErrors])

  const uploading = uploadingKeys.size > 0
  const dirty = JSON.stringify(requestBody(resource, draft)) !== initial
  const role = reviewerRole
  const section = draft.section
  const typeGroups = getResourceTypeGroups(section)
  const { chineseSupport: selectedChineseSupport } = splitTypesByChineseSupport(
    draft.type
  )
  const typeState = applyTypeChange(section, draft.type, draft.platform)
  const chineseSupportSelectable =
    section === 'galgame' && typeState.chineseSupportSelectable
  const typeMessage = fieldMessage(fieldErrors, 'type')

  const clear = (...paths: string[]) =>
    setFieldErrors((current) => {
      const next = current.filter((item) => !paths.includes(item.path))
      return next.length === current.length ? current : next
    })

  const patchLink = (
    key: string,
    patch: (link: EditableDraft) => EditableDraft
  ) =>
    setDraft((current) => ({
      ...current,
      links: current.links.map((link) =>
        link.key === key ? patch(link) : link
      )
    }))

  const setUploadingFor = (key: string, active: boolean) =>
    setUploadingKeys((current) => {
      const next = new Set(current)
      if (active) next.add(key)
      else next.delete(key)
      return next
    })

  const setTypes = (types: string[]) => {
    clear('type', 'platform')
    const applied = applyTypeChange(section, types, draft.platform)
    setDraft({ ...draft, type: applied.types, platform: applied.platforms })
  }

  const save = async () => {
    if (saving || uploading) return
    if (!resource.baseLinks) {
      setError('链接版本信息缺失，请刷新事项后再编辑')
      return
    }
    const body = requestBody(resource, draft)
    const parsed = patchResourceStableEditFormSchema.safeParse(body)
    if (!parsed.success) {
      const fields = workspaceValidationFeedback(parsed.error).fields
      scrollToError.current = fields[0]?.path ?? ''
      setFieldErrors(fields)
      return
    }
    setFieldErrors([])
    setError('')
    setSaving(true)
    try {
      const response = await kunFetchPut<
        PatchResourceStableUpdateResponse | string
      >('/admin/resource', body)
      if (typeof response === 'string') {
        // Drafts survive every failure, including a version conflict.
        setError(response || '保存失败，请稍后重试')
        toast.error(response || '保存失败，请稍后重试')
        return
      }
      if (!isDefiniteSave(response, resource.id)) {
        setError('没有确认这次保存是否已经写入，请刷新事项核对后再操作')
        return
      }
      toast.success('修改已保存，资源仍待审核')
      onSaved()
    } catch {
      setError('网络错误，保存失败，请重试')
      toast.error('网络错误，保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspaceUserProvider
      user={{ id: reviewerId, name: '', role: reviewerRole }}
    >
      <div
        className={
          isPhone ? 'flex flex-col gap-3' : 'flex h-full min-h-0 flex-col gap-3'
        }
      >
        {/* On phones the page scrolls as a whole, so the form is not boxed. */}
        <div
          className={
            isPhone
              ? 'rounded-md border p-3'
              : 'min-h-0 flex-1 overflow-y-auto rounded-md border p-3'
          }
        >
          <div className="grid min-w-0 gap-3">
            <label className="grid gap-1 text-sm">
              名称
              <Input
                aria-label="资源名称"
                className={fieldClass}
                value={draft.name}
                maxLength={300}
                aria-invalid={
                  fieldMessage(fieldErrors, 'name') ? true : undefined
                }
                onChange={(event) => {
                  clear('name')
                  setDraft({ ...draft, name: event.target.value })
                }}
              />
              <FieldHint
                id={fieldErrorDomId('name')}
                message={fieldMessage(fieldErrors, 'name')}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1 text-sm">
                <span>分区</span>
                <Select
                  value={section}
                  onValueChange={(value) => {
                    clear('section', 'type', 'platform')
                    const next = toSection(value)
                    const applied = applyTypeChange(
                      next,
                      normalizeTypesBySection(next, draft.type),
                      draft.platform
                    )
                    setDraft({
                      ...draft,
                      section: next,
                      type: applied.types,
                      platform: applied.platforms
                    })
                  }}
                >
                  <SelectTrigger aria-label="资源分区" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_RESOURCE_SECTION.map((value) => (
                      <SelectItem key={value} value={value}>
                        {RESOURCE_SECTION_MAP[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <WorkspaceMultiSelect
                label="类型"
                triggerLabel="资源类型"
                required
                aria-invalid={typeMessage ? true : undefined}
                groups={section === 'galgame' ? typeGroups : undefined}
                options={
                  section === 'galgame'
                    ? undefined
                    : typeGroups.flatMap((group) => group.options)
                }
                selected={draft.type.filter(
                  (type) => !isChineseSupportType(type)
                )}
                onChange={(values) =>
                  setTypes([...values, ...selectedChineseSupport])
                }
              />
              {section === 'galgame' ? (
                <WorkspaceMultiSelect
                  label="中文支持"
                  triggerLabel="中文支持"
                  required={typeState.chineseSupportRequired}
                  disabled={!chineseSupportSelectable}
                  options={getChineseSupportOptions(section)}
                  selected={
                    chineseSupportSelectable ? selectedChineseSupport : []
                  }
                  onChange={(values) =>
                    setTypes([
                      ...draft.type.filter(
                        (type) => !isChineseSupportType(type)
                      ),
                      ...values
                    ])
                  }
                />
              ) : null}
              <WorkspaceMultiSelect
                label="语言"
                triggerLabel="资源语言"
                required
                aria-invalid={Boolean(fieldMessage(fieldErrors, 'language'))}
                options={SUPPORTED_LANGUAGE.map((value) => ({
                  value,
                  label: SUPPORTED_LANGUAGE_MAP[value] ?? value
                }))}
                selected={draft.language}
                onChange={(language) => {
                  clear('language')
                  setDraft({ ...draft, language })
                }}
              />
              <WorkspaceMultiSelect
                label="平台"
                triggerLabel="资源平台"
                required
                aria-invalid={Boolean(fieldMessage(fieldErrors, 'platform'))}
                options={getAllowedPlatformsBySectionAndTypes(
                  section,
                  draft.type
                ).map((value) => ({
                  value,
                  label: SUPPORTED_PLATFORM_MAP[value] ?? value
                }))}
                selected={draft.platform}
                onChange={(platform) => {
                  clear('platform')
                  setDraft({ ...draft, platform })
                }}
              />
            </div>
            <FieldHint id={fieldErrorDomId('type')} message={typeMessage} />
            <FieldHint
              id={fieldErrorDomId('language')}
              message={fieldMessage(fieldErrors, 'language')}
            />
            <FieldHint
              id={fieldErrorDomId('platform')}
              message={fieldMessage(fieldErrors, 'platform')}
            />
            <label className="grid gap-1 text-sm">
              备注
              <Textarea
                aria-label="资源备注"
                className={fieldClass}
                value={draft.note}
                rows={4}
                onChange={(event) => {
                  clear('note')
                  setDraft({ ...draft, note: event.target.value })
                }}
              />
              <FieldHint
                id={fieldErrorDomId('note')}
                message={fieldMessage(fieldErrors, 'note')}
              />
            </label>
            {draft.links.map((link, index) => (
              <section
                key={link.key}
                aria-label={`链接 #${index + 1}`}
                className="grid min-w-0 gap-2 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">链接 #{index + 1}</h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`移除链接 #${index + 1}`}
                    disabled={draft.links.length <= 1}
                    onClick={() => {
                      setUploadingFor(link.key, false)
                      clear('links')
                      setDraft({
                        ...draft,
                        links: draft.links.filter(
                          (item) => item.key !== link.key
                        )
                      })
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <EditableLinkFields
                  link={link}
                  index={index}
                  errors={fieldErrors}
                  disabled={saving}
                  role={role}
                  section={section}
                  canEdit
                  sessionEpoch={0}
                  uploadActive={uploadingKeys.has(link.key)}
                  onUploadingChange={(active) =>
                    setUploadingFor(link.key, active)
                  }
                  onClear={clear}
                  onPatch={(patch) => patchLink(link.key, patch)}
                />
              </section>
            ))}
            <FieldHint
              id={fieldErrorDomId('links')}
              message={fieldMessage(fieldErrors, 'links')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={saving || draft.links.length >= 10}
              onClick={() => {
                clear('links')
                setDraft({
                  ...draft,
                  links: [
                    ...draft.links,
                    {
                      key: `new-${Date.now()}-${draft.links.length}`,
                      protected: false,
                      storage: getDefaultLinkStorage(section, role),
                      content: '',
                      code: '',
                      password: '',
                      hash: '',
                      size: ''
                    }
                  ]
                })
              }}
            >
              <Plus aria-hidden />
              添加链接
            </Button>
          </div>
        </div>
        {fieldErrors.length > 0 ? (
          <p role="alert" className="text-sm break-all text-destructive">
            {fieldErrors.map((item) => item.message).join('；')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm break-all text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            disabled={!dirty || saving || uploading}
            onClick={() => void save()}
          >
            {saving ? '正在保存…' : uploading ? '正在上传…' : '保存修改'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={confirmDiscard ? 'destructive' : 'outline'}
            disabled={saving}
            onClick={() => {
              if (dirty && !confirmDiscard) {
                setConfirmDiscard(true)
                return
              }
              onCancel()
            }}
          >
            {confirmDiscard ? '确认放弃修改' : '取消'}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            保存后仍待审核，上传者会收到修改通知
          </span>
        </div>
      </div>
    </WorkspaceUserProvider>
  )
}
