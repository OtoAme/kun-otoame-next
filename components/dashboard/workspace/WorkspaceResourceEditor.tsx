'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/dashboard/ui/alert-dialog'
import { Button } from '~/components/dashboard/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
import { Input } from '~/components/dashboard/ui/input'
import { Textarea } from '~/components/dashboard/ui/textarea'
import {
  getAllowedPlatformsBySectionAndTypes,
  getResourceTypeOptionsBySection,
  normalizeTypesBySection,
  RESOURCE_SECTION_MAP,
  storageTypes,
  SUPPORTED_LANGUAGE,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_SECTION
} from '~/constants/resource'
import { WORKSPACE_ERRORS } from '~/constants/workspace'
import { canManageResourceLink } from '~/components/patch/resource/resourcePermissions'
import { useWorkspaceUser } from './WorkspaceShell'
import type { LinkVersionBase } from '~/types/api/linkHealth'
import type { PatchResourceStableUpdateResponse } from '~/types/api/patch'
import type {
  WorkspaceEditableLink,
  WorkspaceProtectedLink,
  WorkspaceResourceDetail,
  WorkspaceResourceLinkInput,
  WorkspaceResourceUpdateInput
} from '~/types/api/workspace'
import type { ResourceSection } from '~/constants/resource'
import { kunFetchDelete, kunFetchGet, kunFetchPut } from '~/utils/kunFetch'
import { WorkspaceMaintenanceCard } from './WorkspaceMaintenance'
import { WorkspaceResourceUpload } from './WorkspaceResourceUpload'

type EditableDraft = {
  key: string
  protected: false
  id?: number
  storage: string
  content: string
  code: string
  password: string
  hash: string
  size: string
  uploadId?: string
}

type ProtectedDraft = {
  key: string
  protected: true
  id: number
  version: number
  storage: string
}

type LinkDraft = EditableDraft | ProtectedDraft

export type WorkspaceEditorSession = {
  resourceId: number
  baseLinks: LinkVersionBase[]
  name: string
  section: string
  note: string
  type: string[]
  language: string[]
  platform: string[]
  links: LinkDraft[]
}

const fieldClass = 'min-w-0 max-w-full break-all [overflow-wrap:anywhere]'

export function sessionFromDetail(
  detail: WorkspaceResourceDetail
): WorkspaceEditorSession {
  return {
    resourceId: detail.id,
    baseLinks: detail.baseLinks.map((link) => ({
      id: link.id,
      version: link.version
    })),
    name: detail.name,
    section: detail.section,
    note: detail.note,
    type: [...detail.type],
    language: [...detail.language],
    platform: [...detail.platform],
    links: detail.links.map((link) => linkDraft(link))
  }
}

function linkDraft(
  link: WorkspaceProtectedLink | WorkspaceEditableLink
): LinkDraft {
  if (link.protected) {
    return {
      key: `protected-${link.id}`,
      protected: true,
      id: link.id,
      version: link.version,
      storage: link.storage
    }
  }
  return {
    key: `link-${link.id}`,
    protected: false,
    id: link.id,
    storage: link.storage,
    content: link.content,
    code: link.code,
    password: link.password,
    hash: link.hash,
    size: link.size
  }
}

/** Protected slots travel as exactly { id, version }, in the edited order. */
export function buildWorkspaceResourceUpdate(
  session: WorkspaceEditorSession
): WorkspaceResourceUpdateInput {
  return {
    name: session.name,
    section:
      session.section === 'patch' || session.section === 'galgame'
        ? session.section
        : 'galgame',
    note: session.note,
    type: session.type,
    language: session.language,
    platform: session.platform,
    baseLinks: session.baseLinks.map((link) => ({
      id: link.id,
      version: link.version
    })),
    links: session.links.map((link) => linkInput(link))
  }
}

export function linkInput(link: LinkDraft): WorkspaceResourceLinkInput {
  if (link.protected) return { id: link.id, version: link.version }
  const editable: WorkspaceResourceLinkInput = {
    ...(link.id ? { id: link.id } : {}),
    storage: link.storage,
    content: link.content,
    code: link.code,
    password: link.password,
    hash: link.hash,
    size: link.size,
    ...(link.uploadId ? { uploadId: link.uploadId } : {})
  }
  return editable
}

function toggleValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

export function WorkspaceResourceEditor({
  resourceId,
  focusLinkId
}: {
  resourceId: number
  focusLinkId?: number
}) {
  const router = useRouter()
  const workspaceUser = useWorkspaceUser()
  const role = workspaceUser.role
  const uid = workspaceUser.id
  const [detail, setDetail] = useState<WorkspaceResourceDetail | null>(null)
  const [session, setSession] = useState<WorkspaceEditorSession | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const capturedFor = useRef<number | null>(null)
  const requestRef = useRef(0)
  const consumedUploadIds = useRef(new Set<string>())
  const focusedTarget = useRef<string | null>(null)

  const load = async (replaceSession: boolean) => {
    const request = ++requestRef.current
    const requestedId = resourceId
    setLoading(true)
    setError('')
    try {
      const response = await kunFetchGet<WorkspaceResourceDetail | string>(
        `/workspace/resources/${requestedId}`
      )
      if (request !== requestRef.current) return
      if (typeof response === 'string') {
        setError(response || '加载资源失败')
        return
      }
      if (response.id !== requestedId) return
      setDetail(response)
      setSession((current) => {
        if (request !== requestRef.current) return current
        if (
          !replaceSession &&
          current &&
          current.resourceId === response.id &&
          capturedFor.current === response.id
        ) {
          return current
        }
        capturedFor.current = response.id
        return sessionFromDetail(response)
      })
      setError('')
    } catch {
      if (request !== requestRef.current) return
      setError('网络错误，资源加载失败，请重试')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    capturedFor.current = null
    consumedUploadIds.current = new Set()
    setSession(null)
    setDetail(null)
    setError('')
    void load(true)
    // resourceId is the session boundary; load closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId])

  useEffect(() => {
    focusedTarget.current = null
  }, [focusLinkId, resourceId])

  useEffect(() => {
    if (!focusLinkId || !session || session.resourceId !== resourceId) return
    const target = `${resourceId}:${focusLinkId}`
    if (focusedTarget.current === target) return
    const node = document.getElementById(`workspace-link-${focusLinkId}`)
    if (!node) return
    focusedTarget.current = target
    node.scrollIntoView({ block: 'center' })
  }, [focusLinkId, resourceId, session])

  const canEdit = Boolean(detail?.capabilities.canEdit && session)
  const canDelete = Boolean(detail?.capabilities.canDelete)

  const save = async () => {
    if (!session || !canEdit || saving) return
    const request = ++requestRef.current
    const submittedResourceId = resourceId
    const submitted = withoutConsumedUploads(session, consumedUploadIds.current)
    setSaving(true)
    setError('')
    const payload = buildWorkspaceResourceUpdate(submitted)
    try {
      const response = await kunFetchPut<
        PatchResourceStableUpdateResponse | string
      >(`/workspace/resources/${submittedResourceId}`, payload)
      if (request !== requestRef.current) return
      if (typeof response === 'string') {
        setError(response || WORKSPACE_ERRORS.conflict.message)
        return
      }
      for (const link of submitted.links) {
        if (!link.protected && link.uploadId) {
          consumedUploadIds.current.add(link.uploadId)
        }
      }
      setSession((current) =>
        current && current.resourceId === submittedResourceId
          ? withoutConsumedUploads(current, consumedUploadIds.current)
          : current
      )
      const refreshed = await kunFetchGet<WorkspaceResourceDetail | string>(
        `/workspace/resources/${submittedResourceId}`
      )
      if (request !== requestRef.current) return
      if (typeof refreshed === 'string') {
        setError(refreshed || '保存已提交，重新读取失败，请重试')
        return
      }
      if (refreshed.id !== submittedResourceId) return
      setDetail(refreshed)
      setSession((current) => {
        if (request !== requestRef.current || !current) return current
        if (current.resourceId !== refreshed.id) return current
        return hydrateCommittedSave(
          withoutConsumedUploads(current, consumedUploadIds.current),
          submitted,
          refreshed
        )
      })
      capturedFor.current = refreshed.id
    } catch {
      if (request !== requestRef.current) return
      setError('网络错误，保存失败，请重试')
    } finally {
      if (request === requestRef.current) setSaving(false)
    }
  }

  const removeResource = async () => {
    if (!canDelete) return
    setDeleting(true)
    try {
      const response = await kunFetchDelete<
        { deleted: true; moemoepointBalance?: { available: number } } | string
      >(`/workspace/resources/${resourceId}`)
      if (typeof response === 'string') {
        setError(response)
        return
      }
      router.push('/workspace/resources')
    } catch {
      setError('网络错误，删除失败，请重试')
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  if (loading && !session) return <p className="text-sm">正在加载资源…</p>
  if (!session || !detail) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error || '资源不存在或不可访问'}
      </p>
    )
  }

  const section = (
    SUPPORTED_RESOURCE_SECTION.includes(session.section as ResourceSection)
      ? session.section
      : 'galgame'
  ) as ResourceSection
  const typeOptions = getResourceTypeOptionsBySection(section)
  const platformOptions = getAllowedPlatformsBySectionAndTypes(
    section,
    session.type
  )

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-all text-2xl font-semibold">
            {session.name || '未命名资源'}
          </h1>
          <p className="break-all text-sm text-muted-foreground">
            {detail.patchName}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/workspace/resources">返回我的资源</Link>
        </Button>
      </div>
      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          待审核或封禁的资源只读，不显示凭据。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>资源信息</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-3">
          <label className="grid gap-1 text-sm">
            名称
            <Input
              aria-label="资源名称"
              className={fieldClass}
              value={session.name}
              disabled={!canEdit}
              maxLength={300}
              onChange={(event) =>
                setSession({ ...session, name: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            分区
            <select
              aria-label="资源分区"
              className="h-9 rounded-md border bg-background px-2"
              disabled={!canEdit}
              value={session.section}
              onChange={(event) => {
                const nextSection = event.target.value as ResourceSection
                const type = normalizeTypesBySection(nextSection, session.type)
                const allowed = new Set(
                  getAllowedPlatformsBySectionAndTypes(nextSection, type)
                )
                setSession({
                  ...session,
                  section: nextSection,
                  type,
                  platform: session.platform.filter((item) => allowed.has(item))
                })
              }}
            >
              {SUPPORTED_RESOURCE_SECTION.map((value) => (
                <option key={value} value={value}>
                  {RESOURCE_SECTION_MAP[value]}
                </option>
              ))}
            </select>
          </label>
          <ChoiceGroup
            label="类型"
            disabled={!canEdit}
            options={typeOptions.map((item) => ({
              value: item.value,
              label: item.label
            }))}
            selected={session.type}
            onChange={(type) => setSession({ ...session, type })}
          />
          <ChoiceGroup
            label="语言"
            disabled={!canEdit}
            options={SUPPORTED_LANGUAGE.map((value) => ({
              value,
              label: SUPPORTED_LANGUAGE_MAP[value] ?? value
            }))}
            selected={session.language}
            onChange={(language) => setSession({ ...session, language })}
          />
          <ChoiceGroup
            label="平台"
            disabled={!canEdit}
            options={platformOptions.map((value) => ({
              value,
              label: SUPPORTED_PLATFORM_MAP[value] ?? value
            }))}
            selected={session.platform}
            onChange={(platform) => setSession({ ...session, platform })}
          />
          <label className="grid gap-1 text-sm">
            备注
            <Textarea
              aria-label="资源备注"
              className={fieldClass}
              value={session.note}
              disabled={!canEdit}
              onChange={(event) =>
                setSession({ ...session, note: event.target.value })
              }
            />
          </label>
        </CardContent>
      </Card>
      <div className="grid min-w-0 gap-3">
        {session.links.map((link, index) => (
          <Card
            key={link.key}
            id={link.id ? `workspace-link-${link.id}` : undefined}
            className="min-w-0 max-w-full"
          >
            <CardHeader>
              <CardTitle className="text-base">链接 #{index + 1}</CardTitle>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-2">
              {link.protected ? (
                <p className="text-sm text-muted-foreground">
                  {link.storage === 'touchgal'
                    ? `${storageLabel(link.storage)}由网站管理，不能在这里修改。`
                    : '这条链接只读，不显示凭据。'}
                </p>
              ) : (
                <EditableLinkFields
                  link={link}
                  disabled={!canEdit}
                  role={role}
                  section={section}
                  canUpload={detail.capabilities.canUpload}
                  onChange={(next) =>
                    setSession({
                      ...session,
                      links: session.links.map((item) =>
                        item.key === link.key ? next : item
                      )
                    })
                  }
                />
              )}
              {link.id
                ? detail.maintenance
                    .filter((item) => item.linkId === link.id)
                    .map((item) => (
                      <WorkspaceMaintenanceCard
                        key={`${item.linkId}:${item.linkVersion}:${item.maintenanceRevision}`}
                        item={item}
                        onChanged={() => void load(false)}
                      />
                    ))
                : null}
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (link.protected) return
                    if (
                      !canManageResourceLink({
                        storage: link.storage,
                        resourceUserId: uid,
                        userId: uid,
                        userRole: role
                      })
                    ) {
                      setError('资源盘链接不能由普通作者删除')
                      return
                    }
                    if (session.links.length <= 1) {
                      setDeleteOpen(true)
                      return
                    }
                    setSession({
                      ...session,
                      links: session.links.filter(
                        (item) => item.key !== link.key
                      )
                    })
                  }}
                >
                  {session.links.length <= 1 ? '删除整个资源' : '移除这条链接'}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {detail.maintenance
        .filter(
          (item) => !session.links.some((link) => link.id === item.linkId)
        )
        .map((item) => (
          <WorkspaceMaintenanceCard
            key={`${item.linkId}:${item.linkVersion}:${item.maintenanceRevision}`}
            item={item}
            onChanged={() => void load(false)}
          />
        ))}
      {canEdit || canDelete ? (
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setSession({
                    ...session,
                    links: [
                      ...session.links,
                      {
                        key: `new-${session.links.length}-${Date.now()}`,
                        protected: false,
                        storage: role > 3 ? 'touchgal' : 'user',
                        content: '',
                        code: '',
                        password: '',
                        hash: '',
                        size: ''
                      }
                    ]
                  })
                }
              >
                添加链接
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? '正在保存…' : '保存'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void load(false)}
              >
                重新读取
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              删除资源
            </Button>
          ) : null}
        </div>
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除整个资源</AlertDialogTitle>
            <AlertDialogDescription>
              最后一条链接不能单独删除。确认后会删除整份资源，发布时获得的萌萌点奖励会被收回，该操作不可撤销。受保护的资源盘链接仍不能由普通作者删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || !canDelete}
              onClick={() => void removeResource()}
            >
              {deleting ? '正在删除…' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function withoutConsumedUploads(
  session: WorkspaceEditorSession,
  consumed: ReadonlySet<string>
): WorkspaceEditorSession {
  return {
    ...session,
    links: session.links.map((link) => {
      if (link.protected || !link.uploadId || !consumed.has(link.uploadId)) {
        return link
      }
      const { uploadId: _uploadId, ...rest } = link
      return rest
    })
  }
}

function dropUploadId(link: EditableDraft): EditableDraft {
  if (!link.uploadId) return link
  const { uploadId: _uploadId, ...rest } = link
  return rest
}

/**
 * After a committed save, canonical detail replaces fields the user did not
 * change while the request was in flight. A consumed upload id is never kept.
 */
export function hydrateCommittedSave(
  current: WorkspaceEditorSession,
  submitted: WorkspaceEditorSession,
  detail: WorkspaceResourceDetail
): WorkspaceEditorSession {
  const canonical = sessionFromDetail(detail)
  const sameLength = submitted.links.length === canonical.links.length
  const arraysEqual = (left: string[], right: string[]) =>
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  const links = current.links.map((link) => {
    const submittedIndex = submitted.links.findIndex(
      (item) => item.key === link.key
    )
    const submittedLink =
      submittedIndex >= 0 ? submitted.links[submittedIndex] : undefined
    const canonicalLink =
      (link.id != null
        ? canonical.links.find((item) => item.id === link.id)
        : undefined) ??
      (sameLength && submittedIndex >= 0
        ? canonical.links[submittedIndex]
        : undefined)
    if (!canonicalLink) {
      if (
        !link.protected &&
        submittedLink &&
        !submittedLink.protected &&
        link.uploadId &&
        link.uploadId === submittedLink.uploadId
      ) {
        return dropUploadId(link)
      }
      return link
    }
    if (link.protected || canonicalLink.protected) {
      return { ...canonicalLink, key: link.key }
    }
    const next: EditableDraft = {
      ...canonicalLink,
      key: link.key,
      protected: false
    }
    if (!submittedLink || submittedLink.protected) return dropUploadId(next)
    const fields = [
      'storage',
      'content',
      'code',
      'password',
      'hash',
      'size'
    ] as const
    for (const field of fields) {
      if (link[field] !== submittedLink[field]) next[field] = link[field]
    }
    if (link.uploadId && link.uploadId !== submittedLink.uploadId) {
      next.uploadId = link.uploadId
    } else {
      delete next.uploadId
    }
    return next
  })
  return {
    resourceId: current.resourceId,
    baseLinks: canonical.baseLinks.map((item) => ({
      id: item.id,
      version: item.version
    })),
    name: current.name === submitted.name ? canonical.name : current.name,
    section:
      current.section === submitted.section
        ? canonical.section
        : current.section,
    note: current.note === submitted.note ? canonical.note : current.note,
    type: arraysEqual(current.type, submitted.type)
      ? canonical.type
      : current.type,
    language: arraysEqual(current.language, submitted.language)
      ? canonical.language
      : current.language,
    platform: arraysEqual(current.platform, submitted.platform)
      ? canonical.platform
      : current.platform,
    links
  }
}

function storageLabel(storage: string) {
  return storageTypes.find((item) => item.value === storage)?.label ?? storage
}

function ChoiceGroup({
  label,
  options,
  selected,
  disabled,
  onChange
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  disabled: boolean
  onChange: (values: string[]) => void
}) {
  return (
    <fieldset className="min-w-0 space-y-1" disabled={disabled}>
      <legend className="text-sm">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onChange(toggleValue(selected, option.value))}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function EditableLinkFields({
  link,
  disabled,
  role,
  section,
  canUpload,
  onChange
}: {
  link: EditableDraft
  disabled: boolean
  role: number
  section: string
  canUpload: boolean
  onChange: (link: EditableDraft) => void
}) {
  const disabledStorage = new Set(
    role > 3
      ? []
      : role > 1 && section === 'patch'
        ? ['touchgal']
        : ['s3', 'touchgal']
  )
  return (
    <div className="grid min-w-0 gap-2">
      <label className="grid gap-1 text-sm">
        存储
        <select
          aria-label="链接存储"
          className="h-9 max-w-full rounded-md border bg-background px-2"
          disabled={disabled}
          value={link.storage}
          onChange={(event) =>
            onChange({ ...link, storage: event.target.value })
          }
        >
          {storageTypes.map((item) => (
            <option
              key={item.value}
              value={item.value}
              disabled={disabledStorage.has(item.value)}
            >
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        地址
        <Input
          aria-label="链接地址"
          className={fieldClass}
          disabled={disabled}
          readOnly={link.storage === 's3'}
          value={link.content}
          onChange={(event) =>
            onChange({ ...link, content: event.target.value })
          }
        />
      </label>
      <label className="grid gap-1 text-sm">
        提取码
        <Input
          aria-label="提取码"
          className={fieldClass}
          disabled={disabled}
          value={link.code}
          onChange={(event) => onChange({ ...link, code: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm">
        解压码
        <Input
          aria-label="解压码"
          className={fieldClass}
          disabled={disabled}
          value={link.password}
          onChange={(event) =>
            onChange({ ...link, password: event.target.value })
          }
        />
      </label>
      <label className="grid gap-1 text-sm">
        大小
        <Input
          aria-label="资源大小"
          className={fieldClass}
          disabled={disabled}
          readOnly={link.storage === 's3'}
          value={link.size}
          placeholder="例如 1.2GB"
          onChange={(event) => onChange({ ...link, size: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm">
        校验
        <Input
          aria-label="校验值"
          className={fieldClass}
          disabled={disabled}
          readOnly={link.storage === 's3'}
          value={link.hash}
          onChange={(event) => onChange({ ...link, hash: event.target.value })}
        />
      </label>
      {canUpload && link.storage === 's3' ? (
        <WorkspaceResourceUpload
          disabled={disabled}
          onUploaded={(result) =>
            onChange({
              ...link,
              storage: 's3',
              uploadId: result.uploadId,
              hash: result.hash,
              size: result.size
            })
          }
        />
      ) : null}
    </div>
  )
}
