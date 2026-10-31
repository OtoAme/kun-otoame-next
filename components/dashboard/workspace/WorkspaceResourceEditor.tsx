'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
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
  CardAction,
  CardContent,
  CardHeader,
  CardTitle
} from '~/components/dashboard/ui/card'
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
  canSelectChineseSupportType,
  getAllowedPlatformsBySectionAndTypes,
  normalizeTypesBySection,
  RESOURCE_SECTION_MAP,
  storageTypes,
  SUPPORTED_LANGUAGE,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_SECTION
} from '~/constants/resource'
import { WORKSPACE_ERRORS } from '~/constants/workspace'
import {
  applyStorageSwitch,
  applyTypeChange,
  getChineseSupportOptions,
  getDefaultLinkStorage,
  getDisabledStorageKeys,
  getResourceTypeGroups,
  isChineseSupportType,
  splitTypesByChineseSupport
} from '~/utils/resourceFormRules'
import { canManageResourceLink } from '~/components/patch/resource/resourcePermissions'
import { parseResourceLink } from '~/utils/resourceLink'
import { useWorkspaceUser, workspaceActionError } from './WorkspaceShell'
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
import { workspaceResourceUpdateSchema } from '~/validations/workspace'
import { workspaceValidationFeedback } from '~/validations/workspaceFeedback'
import { kunFetchDelete, kunFetchGet, kunFetchPut } from '~/utils/kunFetch'
import { WorkspaceMaintenanceCard } from './WorkspaceMaintenance'
import { WorkspaceMultiSelect } from './WorkspaceMultiSelect'
import { WorkspaceResourceUpload } from './WorkspaceResourceUpload'

export type EditableDraft = {
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
  /**
   * Bumps only when an explicit successful read installs a new session.
   * Upload slots key on it so the same link id cannot reuse an old attempt.
   */
  epoch: number
}

const fieldClass = 'min-w-0 max-w-full break-all [overflow-wrap:anywhere]'

const READ_AFTER_SAVE =
  '保存已经成功，但没有读到最新内容。请使用「载入最新版本」读取。不要为了重新读取而再次保存。'

const SAVE_UNCONFIRMED =
  '没有确认这次保存是否已经写入。请使用「载入最新版本」核对。不要为了确认而再次保存。'

const DELETE_UNCONFIRMED =
  '没有确认这次删除是否已经完成。请使用「载入最新版本」核对。不要为了确认而再次删除。'

export type FieldError = { path: string; message: string }

export const fieldErrorDomId = (path: string) => {
  const safe = path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `workspace-field-${safe || 'form'}`
}

/** A 200 is definite only when it names this resource and its link list. */
function isDefiniteResourceSave(
  response: unknown,
  resourceId: number
): response is PatchResourceStableUpdateResponse {
  if (!response || typeof response !== 'object') return false
  const body = response as {
    id?: unknown
    links?: unknown
    linkChecks?: unknown
  }
  return (
    body.id === resourceId &&
    Array.isArray(body.links) &&
    Array.isArray(body.linkChecks)
  )
}

function isDefiniteResourceDelete(
  response: unknown
): response is { deleted: true } {
  if (!response || typeof response !== 'object') return false
  return (response as { deleted?: unknown }).deleted === true
}

export function fieldMessage(errors: FieldError[], path: string) {
  return errors.find((item) => item.path === path)?.message
}

/** Errors for a link control this form does not render. */
function unrenderedLinkErrors(
  link: { protected: boolean; storage: string },
  index: number,
  errors: FieldError[],
  showUpload: boolean
) {
  return errors.filter((item) => {
    const match = new RegExp(`^links\\.${index}(?:\\.([A-Za-z0-9]+))?$`).exec(
      item.path
    )
    if (!match) return false
    const field = match[1]
    if (!field || link.protected) return true
    if (field === 'hash') return link.storage !== 's3'
    if (field === 'uploadId') return !showUpload
    return false
  })
}

function editedSinceSnapshot(
  session: WorkspaceEditorSession,
  snapshot: WorkspaceEditorSession,
  consumed: ReadonlySet<string>
): boolean {
  const strip = new Set(consumed)
  for (const link of snapshot.links) {
    if (!link.protected && link.uploadId) strip.add(link.uploadId)
  }
  return isSessionDirty(
    withoutConsumedUploads(session, strip),
    withoutConsumedUploads(snapshot, strip)
  )
}

function validationFocusId(
  path: string,
  session: WorkspaceEditorSession,
  message = ''
): string {
  if (path === 'name') return 'workspace-resource-name'
  if (path === 'note') return 'workspace-resource-note'
  if (path === 'section') return 'workspace-resource-section-control'
  if (path === 'type') {
    if (
      message.includes('请选择中文支持情况') &&
      session.section === 'galgame' &&
      canSelectChineseSupportType(session.type)
    ) {
      return 'workspace-resource-chinese'
    }
    return 'workspace-resource-type'
  }
  if (path === 'language') return 'workspace-resource-language'
  if (path === 'platform') return 'workspace-resource-platform'
  if (path === 'links') return 'workspace-resource-links'
  const match = /^links\.(\d+)(?:\.(\w+))?$/.exec(path)
  if (!match) return 'workspace-editor-error'
  const index = Number(match[1])
  const field = match[2]
  const link = session.links[index]
  if (!link || link.protected || !field) return `workspace-link-card-${index}`
  if (field === 'hash' && link.storage !== 's3')
    return `workspace-link-card-${index}`
  if (field === 'uploadId' && link.storage !== 's3')
    return `workspace-link-card-${index}`
  if (field === 'content') return `workspace-link-${index}-content`
  if (field === 'code') return `workspace-link-${index}-code`
  if (field === 'password') return `workspace-link-${index}-password`
  if (field === 'size') return `workspace-link-${index}-size`
  if (field === 'hash') return `workspace-link-${index}-hash`
  if (field === 'storage') return `workspace-link-${index}-storage`
  if (field === 'uploadId') return `workspace-link-${index}-upload`
  return `workspace-link-card-${index}`
}

function blockedFieldNote(path: string, link?: LinkDraft): string {
  if (path === 'baseLinks' || path.startsWith('baseLinks.'))
    return '原链接版本不能在这里修改。请载入最新版本查看，不要在这里补写。'
  if (!link) return ''
  if (link.protected) return '这条链接不能在这里修改。'
  if (path.endsWith('.hash') && link.storage !== 's3')
    return '这条校验值不能在这里修改。'
  if (path.endsWith('.uploadId') && link.storage !== 's3')
    return '这里不能补写上传登记。'
  if (path.endsWith('.size') && link.storage === 's3')
    return '对象存储的大小由上传结果决定，不能在这里手改。'
  if (path.endsWith('.content') && link.storage === 's3')
    return '对象存储的地址由网站管理，不能在这里手改。'
  return ''
}

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
    links: detail.links.map((link) => linkDraft(link)),
    epoch: 0
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

/**
 * Dirty means the normalized edit payload differs from the base captured when
 * the session opened, or an upload id is still waiting to be submitted.
 */
export function isSessionDirty(
  session: WorkspaceEditorSession,
  base: WorkspaceEditorSession
): boolean {
  if (session.links.some((link) => !link.protected && Boolean(link.uploadId))) {
    return true
  }
  return (
    JSON.stringify(buildWorkspaceResourceUpdate(session)) !==
    JSON.stringify(buildWorkspaceResourceUpdate(base))
  )
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
  const [removeLinkKey, setRemoveLinkKey] = useState<string | null>(null)
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [readAfterCommitFailed, setReadAfterCommitFailed] = useState(false)
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false)
  const [deleteUnconfirmed, setDeleteUnconfirmed] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [deleteError, setDeleteError] = useState('')
  const [uploadingKeys, setUploadingKeys] = useState<ReadonlySet<string>>(
    new Set()
  )
  const capturedFor = useRef<number | null>(null)
  const baseSession = useRef<WorkspaceEditorSession | null>(null)
  const readAfterCommitRef = useRef(false)
  const saveUnconfirmedRef = useRef(false)
  const deleteUnconfirmedRef = useRef(false)
  const committedSnapshot = useRef<WorkspaceEditorSession | null>(null)
  const requestRef = useRef(0)
  const consumedUploadIds = useRef(new Set<string>())
  const focusedTarget = useRef<string | null>(null)
  const pendingFocus = useRef('')

  const load = async (replaceSession: boolean) => {
    const request = ++requestRef.current
    const requestedId = resourceId
    const markReload = replaceSession && capturedFor.current === requestedId
    setLoading(true)
    if (markReload) setReloading(true)
    if (
      !readAfterCommitRef.current &&
      !saveUnconfirmedRef.current &&
      !deleteUnconfirmedRef.current
    ) {
      setError('')
    }
    try {
      const response = await kunFetchGet<WorkspaceResourceDetail | string>(
        `/workspace/resources/${requestedId}`
      )
      if (request !== requestRef.current) return
      if (typeof response === 'string') {
        const detailMessage = response || '加载资源失败'
        setError(
          readAfterCommitRef.current
            ? `${READ_AFTER_SAVE} ${detailMessage}`
            : saveUnconfirmedRef.current
              ? `${SAVE_UNCONFIRMED} ${detailMessage}`
              : deleteUnconfirmedRef.current
                ? `${DELETE_UNCONFIRMED} ${detailMessage}`
                : detailMessage
        )
        return
      }
      if (response.id !== requestedId) {
        if (readAfterCommitRef.current) {
          setError(`${READ_AFTER_SAVE} 读到的不是当前资源。`)
        } else if (saveUnconfirmedRef.current) {
          setError(`${SAVE_UNCONFIRMED} 读到的不是当前资源。`)
        } else if (deleteUnconfirmedRef.current) {
          setError(`${DELETE_UNCONFIRMED} 读到的不是当前资源。`)
        }
        return
      }
      const nextSession = sessionFromDetail(response)
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
        const installed = {
          ...nextSession,
          epoch: replaceSession
            ? (current?.epoch ?? 0) + 1
            : (current?.epoch ?? 0)
        }
        capturedFor.current = response.id
        baseSession.current = installed
        readAfterCommitRef.current = false
        saveUnconfirmedRef.current = false
        deleteUnconfirmedRef.current = false
        committedSnapshot.current = null
        setReadAfterCommitFailed(false)
        setSaveUnconfirmed(false)
        setDeleteUnconfirmed(false)
        setFieldErrors([])
        setError('')
        return installed
      })
      if (
        !readAfterCommitRef.current &&
        !saveUnconfirmedRef.current &&
        !deleteUnconfirmedRef.current
      ) {
        setError('')
      }
    } catch (error) {
      if (request !== requestRef.current) return
      const detailMessage = workspaceActionError(
        error,
        '网络错误，资源加载失败，请重试'
      )
      setError(
        readAfterCommitRef.current
          ? `${READ_AFTER_SAVE} ${detailMessage}`
          : saveUnconfirmedRef.current
            ? `${SAVE_UNCONFIRMED} ${detailMessage}`
            : deleteUnconfirmedRef.current
              ? `${DELETE_UNCONFIRMED} ${detailMessage}`
              : detailMessage
      )
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setReloading(false)
      }
    }
  }

  useEffect(() => {
    capturedFor.current = null
    baseSession.current = null
    readAfterCommitRef.current = false
    saveUnconfirmedRef.current = false
    deleteUnconfirmedRef.current = false
    committedSnapshot.current = null
    pendingFocus.current = ''
    setReadAfterCommitFailed(false)
    setSaveUnconfirmed(false)
    setDeleteUnconfirmed(false)
    setFieldErrors([])
    consumedUploadIds.current = new Set()
    setSession(null)
    setDetail(null)
    setError('')
    setUploadingKeys(new Set())
    void load(true)
    // resourceId is the session boundary; load closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId])

  useEffect(() => {
    focusedTarget.current = null
  }, [focusLinkId, resourceId])

  useEffect(() => {
    const path = pendingFocus.current
    if (!path || !session) return
    pendingFocus.current = ''
    const message =
      fieldErrors.find((item) => item.path === path)?.message ?? ''
    document.getElementById(validationFocusId(path, session, message))?.focus()
  }, [fieldErrors, session])

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
  const uploading = uploadingKeys.size > 0
  const dirty = Boolean(
    session &&
      baseSession.current &&
      capturedFor.current === session.resourceId &&
      isSessionDirty(session, baseSession.current)
  )
  const attemptSnapshot = committedSnapshot.current
  const editedSinceAttempt = Boolean(
    session &&
      attemptSnapshot &&
      editedSinceSnapshot(session, attemptSnapshot, consumedUploadIds.current)
  )
  const saveBlockedUntilRead =
    (readAfterCommitFailed || saveUnconfirmed) && !editedSinceAttempt

  const clearFieldError = (...paths: string[]) => {
    setFieldErrors((current) => {
      const next = current.filter((item) => !paths.includes(item.path))
      return next.length === current.length ? current : next
    })
  }

  const save = async () => {
    if (!session || !canEdit || saving || uploading || saveBlockedUntilRead) {
      return
    }
    const submittedResourceId = resourceId
    const submitted = withoutConsumedUploads(session, consumedUploadIds.current)
    const payload = buildWorkspaceResourceUpdate(submitted)
    const parsed = workspaceResourceUpdateSchema.safeParse(payload)
    if (!parsed.success) {
      const feedback = workspaceValidationFeedback(parsed.error)
      if (
        !readAfterCommitRef.current &&
        !saveUnconfirmedRef.current &&
        !deleteUnconfirmedRef.current
      ) {
        setError('')
      }
      pendingFocus.current = feedback.fields[0]?.path ?? ''
      setFieldErrors(feedback.fields)
      return
    }
    setFieldErrors([])
    const request = ++requestRef.current
    setSaving(true)
    setReloading(false)
    setError('')
    let committed = false
    let settled: WorkspaceEditorSession | null = null
    try {
      const response = await kunFetchPut<
        PatchResourceStableUpdateResponse | string
      >(`/workspace/resources/${submittedResourceId}`, payload)
      if (request !== requestRef.current) return
      if (typeof response === 'string') {
        const message = response || WORKSPACE_ERRORS.conflict.message
        setError(message)
        toast.error(message)
        return
      }
      if (!isDefiniteResourceSave(response, submittedResourceId)) {
        saveUnconfirmedRef.current = true
        setSaveUnconfirmed(true)
        committedSnapshot.current = submitted
        setError(SAVE_UNCONFIRMED)
        toast(SAVE_UNCONFIRMED)
        return
      }
      for (const link of submitted.links) {
        if (!link.protected && link.uploadId) {
          consumedUploadIds.current.add(link.uploadId)
        }
      }
      settled = withoutConsumedUploads(submitted, consumedUploadIds.current)
      setSession((current) =>
        current && current.resourceId === submittedResourceId
          ? withoutConsumedUploads(current, consumedUploadIds.current)
          : current
      )
      committed = true
      saveUnconfirmedRef.current = false
      setSaveUnconfirmed(false)
      const refreshed = await kunFetchGet<WorkspaceResourceDetail | string>(
        `/workspace/resources/${submittedResourceId}`
      )
      if (request !== requestRef.current) return
      if (
        typeof refreshed === 'string' ||
        refreshed.id !== submittedResourceId
      ) {
        readAfterCommitRef.current = true
        committedSnapshot.current = settled
        setReadAfterCommitFailed(true)
        const detailMessage =
          typeof refreshed === 'string'
            ? refreshed || '重新读取失败'
            : '读到的不是当前资源。'
        setError(`${READ_AFTER_SAVE} ${detailMessage}`)
        toast.success('已保存')
        return
      }
      setDetail(refreshed)
      setSession((current) => {
        if (request !== requestRef.current || !current) return current
        if (current.resourceId !== refreshed.id) return current
        const next = hydrateCommittedSave(
          withoutConsumedUploads(current, consumedUploadIds.current),
          submitted,
          refreshed
        )
        // Dirty compares against the server snapshot, not unsaved flight input.
        const canonical = sessionFromDetail(refreshed)
        baseSession.current = { ...canonical, epoch: next.epoch }
        capturedFor.current = refreshed.id
        readAfterCommitRef.current = false
        saveUnconfirmedRef.current = false
        committedSnapshot.current = null
        setReadAfterCommitFailed(false)
        setSaveUnconfirmed(false)
        setFieldErrors([])
        return next
      })
      if (response.linkChecks.some((check) => check.outcome !== 'observed')) {
        toast(
          '保存成功；部分链接的自动检测未完成或结果已过期，状态将稍后更新。'
        )
      } else {
        toast.success('已保存')
      }
    } catch (error) {
      if (request !== requestRef.current) return
      if (committed && settled) {
        readAfterCommitRef.current = true
        saveUnconfirmedRef.current = false
        committedSnapshot.current = settled
        setReadAfterCommitFailed(true)
        setSaveUnconfirmed(false)
        const detailMessage = workspaceActionError(error, '重新读取失败')
        setError(`${READ_AFTER_SAVE} ${detailMessage}`)
        toast.success('已保存')
        return
      }
      const message = workspaceActionError(error, '网络错误，保存失败，请重试')
      setError(message)
      toast.error(message)
    } finally {
      if (request === requestRef.current) setSaving(false)
    }
  }

  const removeResource = async () => {
    if (!canDelete || uploading || deleting || deleteUnconfirmedRef.current) {
      return
    }
    setDeleting(true)
    try {
      const response = await kunFetchDelete<
        { deleted: true; moemoepointBalance?: { available: number } } | string
      >(`/workspace/resources/${resourceId}`)
      if (typeof response === 'string') {
        const message = response || '删除失败，请稍后重试'
        setDeleteError(message)
        setError(message)
        return
      }
      if (!isDefiniteResourceDelete(response)) {
        deleteUnconfirmedRef.current = true
        setDeleteUnconfirmed(true)
        setDeleteError(DELETE_UNCONFIRMED)
        setError(DELETE_UNCONFIRMED)
        toast(DELETE_UNCONFIRMED)
        return
      }
      setDeleteOpen(false)
      setError('')
      router.push('/workspace/resources')
    } catch (error) {
      const message = workspaceActionError(error, '网络错误，删除失败，请重试')
      setDeleteError(message)
      setError(message)
    } finally {
      setDeleting(false)
    }
  }

  const requestReload = () => {
    if (saving || uploading || reloading) return
    if (dirty) {
      setReloadConfirmOpen(true)
      return
    }
    void load(true)
  }

  const confirmRemoveLink = () => {
    const key = removeLinkKey
    setRemoveLinkKey(null)
    if (!key) return
    setUploadingFor(key, false)
    clearFieldError('links')
    setSession((current) => {
      if (!current || current.links.length <= 1) return current
      const target = current.links.find((item) => item.key === key)
      if (
        !target ||
        target.protected ||
        !canManageResourceLink({
          storage: target.storage,
          resourceUserId: uid,
          userId: uid,
          userRole: role
        })
      ) {
        return current
      }
      return {
        ...current,
        links: current.links.filter((item) => item.key !== key)
      }
    })
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
  const typeGroups = getResourceTypeGroups(section)
  const chineseSupportOptions = getChineseSupportOptions(section)
  const { chineseSupport: selectedChineseSupport } = splitTypesByChineseSupport(
    session.type
  )
  const platformOptions = platformOptionsFor(section, session.type)
  const typeState = applyTypeChange(section, session.type, session.platform)
  const chineseSupportSelectable =
    section === 'galgame' && typeState.chineseSupportSelectable
  const typeMessage = fieldMessage(fieldErrors, 'type')
  const chineseSupportError = Boolean(
    typeMessage?.includes('请选择中文支持情况') &&
      section === 'galgame' &&
      canSelectChineseSupportType(session.type)
  )

  const patchEditableLink = (
    key: string,
    epoch: number,
    patch: (link: EditableDraft) => EditableDraft
  ) =>
    setSession((current) => {
      if (!current || current.epoch !== epoch) return current
      return {
        ...current,
        links: current.links.map((item) =>
          item.key === key && !item.protected ? patch(item) : item
        )
      }
    })

  const setUploadingFor = (key: string, active: boolean) =>
    setUploadingKeys((current) => {
      const next = new Set(current)
      if (active) next.add(key)
      else next.delete(key)
      return next
    })

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
      {fieldErrors.length > 0 ? (
        <p
          id="workspace-editor-error"
          role="alert"
          tabIndex={-1}
          className="break-all text-sm text-destructive"
        >
          {fieldErrors.map((item) => item.message).join('；')}
        </p>
      ) : null}
      {fieldErrors.some(
        (item) =>
          item.path === 'baseLinks' || item.path.startsWith('baseLinks.')
      ) ? (
        <p className="text-sm text-muted-foreground">
          {blockedFieldNote('baseLinks')}
        </p>
      ) : null}
      {error ? (
        <p
          id={fieldErrors.length > 0 ? undefined : 'workspace-editor-error'}
          role="alert"
          tabIndex={-1}
          className="break-all text-sm text-destructive"
        >
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
              id="workspace-resource-name"
              aria-label="资源名称"
              aria-invalid={
                fieldMessage(fieldErrors, 'name') ? true : undefined
              }
              aria-describedby={
                fieldMessage(fieldErrors, 'name')
                  ? fieldErrorDomId('name')
                  : undefined
              }
              className={fieldClass}
              value={session.name}
              disabled={!canEdit}
              maxLength={300}
              onChange={(event) => {
                clearFieldError('name')
                setSession({ ...session, name: event.target.value })
              }}
            />
            <FieldHint
              id={fieldErrorDomId('name')}
              message={fieldMessage(fieldErrors, 'name')}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span id="workspace-resource-section">分区</span>
            <Select
              value={section}
              disabled={!canEdit}
              onValueChange={(value) => {
                clearFieldError('section', 'type', 'platform')
                const nextSection = value as ResourceSection
                const type = normalizeTypesBySection(nextSection, session.type)
                const applied = applyTypeChange(
                  nextSection,
                  type,
                  session.platform
                )
                setSession({
                  ...session,
                  section: nextSection,
                  type: applied.types,
                  platform: applied.platforms
                })
              }}
            >
              <SelectTrigger
                id="workspace-resource-section-control"
                aria-label="资源分区"
                aria-invalid={
                  fieldMessage(fieldErrors, 'section') ? true : undefined
                }
                aria-describedby={
                  fieldMessage(fieldErrors, 'section')
                    ? fieldErrorDomId('section')
                    : undefined
                }
                className="w-full"
              >
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
            <FieldHint
              id={fieldErrorDomId('section')}
              message={fieldMessage(fieldErrors, 'section')}
            />
          </div>
          <WorkspaceMultiSelect
            id="workspace-resource-type"
            label="类型"
            triggerLabel="资源类型"
            required
            aria-invalid={
              typeMessage && !chineseSupportError ? true : undefined
            }
            aria-describedby={
              typeMessage && !chineseSupportError
                ? fieldErrorDomId('type')
                : undefined
            }
            disabled={!canEdit}
            groups={section === 'galgame' ? typeGroups : undefined}
            options={
              section === 'galgame'
                ? undefined
                : typeGroups.flatMap((group) => group.options)
            }
            selected={session.type.filter(
              (type) => !isChineseSupportType(type)
            )}
            onChange={(values) => {
              clearFieldError('type', 'platform')
              const applied = applyTypeChange(
                section,
                [...values, ...selectedChineseSupport],
                session.platform
              )
              setSession({
                ...session,
                type: applied.types,
                platform: applied.platforms
              })
            }}
          />
          {chineseSupportError ? null : (
            <FieldHint id={fieldErrorDomId('type')} message={typeMessage} />
          )}
          {section === 'galgame' ? (
            <WorkspaceMultiSelect
              id="workspace-resource-chinese"
              label="中文支持"
              triggerLabel="中文支持"
              required={typeState.chineseSupportRequired}
              disabled={!canEdit || !chineseSupportSelectable}
              aria-invalid={chineseSupportError || undefined}
              aria-describedby={
                chineseSupportError ? fieldErrorDomId('type') : undefined
              }
              options={chineseSupportOptions}
              selected={chineseSupportSelectable ? selectedChineseSupport : []}
              onChange={(values) => {
                clearFieldError('type')
                const applied = applyTypeChange(
                  section,
                  [
                    ...session.type.filter(
                      (type) => !isChineseSupportType(type)
                    ),
                    ...values
                  ],
                  session.platform
                )
                setSession({
                  ...session,
                  type: applied.types,
                  platform: applied.platforms
                })
              }}
            />
          ) : null}
          {chineseSupportError ? (
            <FieldHint id={fieldErrorDomId('type')} message={typeMessage} />
          ) : null}
          {section === 'patch' ? (
            <p className="text-sm text-muted-foreground">
              提示：翻译补丁包括民汉补丁、AI 翻译补丁、机翻补丁
            </p>
          ) : null}
          <WorkspaceMultiSelect
            id="workspace-resource-language"
            label="语言"
            triggerLabel="资源语言"
            required
            disabled={!canEdit}
            options={SUPPORTED_LANGUAGE.map((value) => ({
              value,
              label: SUPPORTED_LANGUAGE_MAP[value] ?? value
            }))}
            selected={session.language}
            aria-invalid={Boolean(fieldMessage(fieldErrors, 'language'))}
            aria-describedby={
              fieldMessage(fieldErrors, 'language')
                ? fieldErrorDomId('language')
                : undefined
            }
            onChange={(language) => {
              clearFieldError('language')
              setSession({ ...session, language })
            }}
          />
          <FieldHint
            id={fieldErrorDomId('language')}
            message={fieldMessage(fieldErrors, 'language')}
          />
          <WorkspaceMultiSelect
            id="workspace-resource-platform"
            label="平台"
            triggerLabel="资源平台"
            required
            aria-invalid={Boolean(fieldMessage(fieldErrors, 'platform'))}
            aria-describedby={
              fieldMessage(fieldErrors, 'platform')
                ? fieldErrorDomId('platform')
                : undefined
            }
            disabled={!canEdit}
            options={platformOptions.map((value) => ({
              value,
              label: SUPPORTED_PLATFORM_MAP[value] ?? value
            }))}
            selected={session.platform}
            onChange={(platform) => {
              clearFieldError('platform')
              setSession({ ...session, platform })
            }}
          />
          <FieldHint
            id={fieldErrorDomId('platform')}
            message={fieldMessage(fieldErrors, 'platform')}
          />
          <label className="grid gap-1 text-sm">
            备注
            <Textarea
              id="workspace-resource-note"
              aria-label="资源备注"
              aria-invalid={
                fieldMessage(fieldErrors, 'note') ? true : undefined
              }
              aria-describedby={
                fieldMessage(fieldErrors, 'note')
                  ? fieldErrorDomId('note')
                  : undefined
              }
              className={fieldClass}
              value={session.note}
              disabled={!canEdit}
              onChange={(event) => {
                clearFieldError('note')
                setSession({ ...session, note: event.target.value })
              }}
            />
            <FieldHint
              id={fieldErrorDomId('note')}
              message={fieldMessage(fieldErrors, 'note')}
            />
          </label>
        </CardContent>
      </Card>
      <div
        id="workspace-resource-links"
        tabIndex={-1}
        className="grid min-w-0 gap-3 outline-none"
      >
        {session.links.map((link, index) => {
          const removable =
            canEdit &&
            !link.protected &&
            session.links.length > 1 &&
            canManageResourceLink({
              storage: link.storage,
              resourceUserId: uid,
              userId: uid,
              userRole: role
            })
          const showUpload =
            canEdit &&
            role >= 2 &&
            (section !== 'galgame' || role >= 3) &&
            !link.protected &&
            link.storage === 's3'
          const hiddenLinkErrors = unrenderedLinkErrors(
            link,
            index,
            fieldErrors,
            showUpload
          )
          return (
            <Card
              key={link.key}
              id={link.id ? `workspace-link-${link.id}` : undefined}
              className="min-w-0 max-w-full"
            >
              <div
                id={`workspace-link-card-${index}`}
                tabIndex={-1}
                className="outline-none"
              >
                <CardHeader>
                  <CardTitle className="text-base">链接 #{index + 1}</CardTitle>
                  {removable ? (
                    <CardAction>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label="移除这条链接"
                        onClick={() => setRemoveLinkKey(link.key)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent className="grid min-w-0 gap-2">
                  <HiddenFieldNotes link={link} errors={hiddenLinkErrors} />
                  {link.protected ? (
                    <p className="text-sm text-muted-foreground">
                      {link.storage === 'touchgal'
                        ? `${storageLabel(link.storage)}由网站管理，不能在这里修改。`
                        : '这条链接只读，不显示凭据。'}
                    </p>
                  ) : (
                    <EditableLinkFields
                      link={link}
                      index={index}
                      errors={fieldErrors}
                      disabled={!canEdit}
                      role={role}
                      section={section}
                      canEdit={canEdit}
                      sessionEpoch={session.epoch}
                      uploadActive={uploadingKeys.has(link.key)}
                      onUploadingChange={(active) =>
                        setUploadingFor(link.key, active)
                      }
                      onClear={clearFieldError}
                      onPatch={(patch) =>
                        patchEditableLink(link.key, session.epoch, patch)
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
                            embedded
                            onChanged={() => void load(false)}
                          />
                        ))
                    : null}
                </CardContent>
              </div>
            </Card>
          )
        })}
      </div>
      {detail.maintenance
        .filter(
          (item) => !session.links.some((link) => link.id === item.linkId)
        )
        .map((item) => (
          <WorkspaceMaintenanceCard
            key={`${item.linkId}:${item.linkVersion}:${item.maintenanceRevision}`}
            item={item}
            embedded
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
                disabled={saving}
                onClick={() => {
                  clearFieldError('links')
                  setSession({
                    ...session,
                    links: [
                      ...session.links,
                      {
                        key: `new-${session.links.length}-${Date.now()}`,
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
                添加链接
              </Button>
              <Button
                type="button"
                disabled={saving || uploading || saveBlockedUntilRead}
                onClick={() => void save()}
              >
                {saving ? '正在保存…' : '保存'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || uploading || reloading}
                aria-busy={reloading || undefined}
                onClick={requestReload}
              >
                {reloading ? '正在载入…' : '载入最新版本'}
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || uploading}
              onClick={() => {
                setDeleteError(deleteUnconfirmed ? DELETE_UNCONFIRMED : '')
                setDeleteOpen(true)
              }}
            >
              删除资源
            </Button>
          ) : null}
        </div>
      ) : null}
      <AlertDialog open={reloadConfirmOpen} onOpenChange={setReloadConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>载入最新版本</AlertDialogTitle>
            <AlertDialogDescription>
              {readAfterCommitFailed
                ? '保存已经成功。载入最新版本只会读取服务器内容，不会再次写入。保存之后又修改的内容会被替换。'
                : saveUnconfirmed
                  ? '没有确认这次保存是否已经写入。载入最新版本只会读取服务器内容，不会再次写入。保存之后又修改的内容会被替换。'
                  : '当前有尚未保存的修改。载入最新版本会丢弃这些修改，是否继续？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setReloadConfirmOpen(false)
                void load(true)
              }}
            >
              确认
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={removeLinkKey !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveLinkKey(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除这条链接</AlertDialogTitle>
            <AlertDialogDescription>
              确认后会从当前编辑中移除这条链接。已有链接要等保存后才真正删除。取消则保持原样。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmRemoveLink}
            >
              确认移除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (open || deleting) return
          setDeleteOpen(false)
          setDeleteError('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除整个资源</AlertDialogTitle>
            <AlertDialogDescription>
              最后一条链接不能单独删除。确认后会删除整份资源，发布时获得的萌萌点奖励会被收回，该操作不可撤销。受保护的资源盘链接仍不能由普通作者删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p
              id="workspace-delete-error"
              role="alert"
              className="break-all text-sm text-destructive"
            >
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={
                deleting || !canDelete || uploading || deleteUnconfirmed
              }
              aria-describedby={
                deleteError ? 'workspace-delete-error' : undefined
              }
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

function platformOptionsFor(section: ResourceSection, types: string[]) {
  return getAllowedPlatformsBySectionAndTypes(section, types)
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
    links,
    epoch: current.epoch
  }
}

function storageLabel(storage: string) {
  return storageTypes.find((item) => item.value === storage)?.label ?? storage
}

export function FieldHint({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="break-all text-sm text-destructive">
      {message}
    </p>
  )
}

function HiddenFieldNotes({
  link,
  errors
}: {
  link: LinkDraft
  errors: FieldError[]
}) {
  if (!errors.length) return null
  return (
    <>
      {errors.map((item) => {
        const note = blockedFieldNote(item.path, link)
        return (
          <div key={item.path}>
            <p
              id={fieldErrorDomId(item.path)}
              role="alert"
              className="break-all text-sm text-destructive"
            >
              {item.message}
            </p>
            {note ? (
              <p className="text-sm text-muted-foreground">{note}</p>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function linkField(errors: FieldError[], index: number, field: string) {
  const path = `links.${index}.${field}`
  const message = fieldMessage(errors, path)
  return {
    path,
    message,
    invalid: message ? (true as const) : undefined,
    describedBy: message ? fieldErrorDomId(path) : undefined
  }
}

export function EditableLinkFields({
  link,
  index,
  errors,
  disabled,
  role,
  section,
  canEdit,
  sessionEpoch,
  uploadActive,
  onUploadingChange,
  onClear,
  onPatch
}: {
  link: EditableDraft
  index: number
  errors: FieldError[]
  disabled: boolean
  role: number
  section: string
  canEdit: boolean
  sessionEpoch: number
  uploadActive: boolean
  onUploadingChange: (active: boolean) => void
  onClear: (...paths: string[]) => void
  onPatch: (patch: (link: EditableDraft) => EditableDraft) => void
}) {
  const disabledStorage = new Set(getDisabledStorageKeys(section, role))
  // Draft section decides the upload gate. Saved canUpload must not stick.
  const canUploadDraftSection =
    canEdit && role >= 2 && (section !== 'galgame' || role >= 3)
  const storage = linkField(errors, index, 'storage')
  const content = linkField(errors, index, 'content')
  const code = linkField(errors, index, 'code')
  const password = linkField(errors, index, 'password')
  const size = linkField(errors, index, 'size')
  const hash = linkField(errors, index, 'hash')
  const upload = linkField(errors, index, 'uploadId')
  const blocked = (path: string, message?: string) =>
    message ? blockedFieldNote(path, link) : ''
  return (
    <div className="grid min-w-0 gap-2">
      <div className="grid gap-1 text-sm">
        <span id={`workspace-link-storage-${link.key}`}>存储</span>
        <Select
          value={link.storage}
          disabled={disabled}
          onValueChange={(value) => {
            onClear(
              storage.path,
              content.path,
              size.path,
              hash.path,
              upload.path
            )
            onPatch((current) => applyStorageSwitch(current, value))
          }}
        >
          <SelectTrigger
            id={`workspace-link-${index}-storage`}
            aria-label="存储类型"
            aria-invalid={storage.invalid}
            aria-describedby={storage.describedBy}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {storageTypes.map((item) => (
              <SelectItem
                key={item.value}
                value={item.value}
                disabled={disabledStorage.has(item.value)}
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldHint
          id={fieldErrorDomId(storage.path)}
          message={storage.message}
        />
      </div>
      <label className="grid gap-1 text-sm">
        地址
        <Input
          id={`workspace-link-${index}-content`}
          aria-label="链接地址"
          aria-invalid={content.invalid}
          aria-describedby={content.describedBy}
          className={fieldClass}
          disabled={disabled}
          readOnly={link.storage === 's3'}
          value={link.content}
          onChange={(event) => {
            onClear(content.path)
            onPatch((current) => ({ ...current, content: event.target.value }))
          }}
          onPaste={(event) => {
            // 与公开投稿一致：只在用户粘贴时识别，加载和普通输入不改写。
            if (disabled || link.storage === 's3') return
            const pasted = event.clipboardData.getData('text')
            if (!pasted.trim()) return
            const parsed = parseResourceLink(pasted)
            if (parsed.url === pasted.trim() && !parsed.code) return
            event.preventDefault()
            onClear(content.path, ...(parsed.code ? [code.path] : []))
            onPatch((current) =>
              parsed.code
                ? { ...current, content: parsed.url, code: parsed.code }
                : { ...current, content: parsed.url }
            )
            if (parsed.code) toast.success('已自动识别并填入提取码')
          }}
        />
        <FieldHint
          id={fieldErrorDomId(content.path)}
          message={content.message}
        />
        {blocked(content.path, content.message) ? (
          <p className="text-sm text-muted-foreground">
            {blocked(content.path, content.message)}
          </p>
        ) : null}
      </label>
      <label className="grid gap-1 text-sm">
        提取码
        <Input
          id={`workspace-link-${index}-code`}
          aria-label="提取码"
          aria-invalid={code.invalid}
          aria-describedby={code.describedBy}
          className={fieldClass}
          disabled={disabled}
          value={link.code}
          onChange={(event) => {
            onClear(code.path)
            onPatch((current) => ({ ...current, code: event.target.value }))
          }}
        />
        <FieldHint id={fieldErrorDomId(code.path)} message={code.message} />
      </label>
      <label className="grid gap-1 text-sm">
        解压码
        <Input
          id={`workspace-link-${index}-password`}
          aria-label="解压码"
          aria-invalid={password.invalid}
          aria-describedby={password.describedBy}
          className={fieldClass}
          disabled={disabled}
          value={link.password}
          onChange={(event) => {
            onClear(password.path)
            onPatch((current) => ({
              ...current,
              password: event.target.value
            }))
          }}
        />
        <FieldHint
          id={fieldErrorDomId(password.path)}
          message={password.message}
        />
      </label>
      <label className="grid gap-1 text-sm">
        大小
        <Input
          id={`workspace-link-${index}-size`}
          aria-label="资源大小"
          aria-invalid={size.invalid}
          aria-describedby={size.describedBy}
          className={fieldClass}
          disabled={disabled}
          readOnly={link.storage === 's3'}
          value={link.size}
          placeholder="例如 1.2GB"
          onChange={(event) => {
            onClear(size.path)
            onPatch((current) => ({ ...current, size: event.target.value }))
          }}
        />
        <FieldHint id={fieldErrorDomId(size.path)} message={size.message} />
        {blocked(size.path, size.message) ? (
          <p className="text-sm text-muted-foreground">
            {blocked(size.path, size.message)}
          </p>
        ) : null}
      </label>
      {link.storage === 's3' ? (
        <label className="grid gap-1 text-sm">
          校验
          <Input
            id={`workspace-link-${index}-hash`}
            aria-label="校验值"
            aria-invalid={hash.invalid}
            aria-describedby={hash.describedBy}
            className={fieldClass}
            disabled={disabled}
            readOnly
            value={link.hash}
            onChange={(event) => {
              onClear(hash.path)
              onPatch((current) => ({ ...current, hash: event.target.value }))
            }}
          />
          <FieldHint id={fieldErrorDomId(hash.path)} message={hash.message} />
        </label>
      ) : null}
      {canUploadDraftSection && link.storage === 's3' ? (
        <>
          <WorkspaceResourceUpload
            id={`workspace-link-${index}-upload`}
            key={`${sessionEpoch}:${link.key}`}
            disabled={disabled || uploadActive}
            invalid={Boolean(upload.message)}
            describedBy={upload.describedBy}
            onUploadingChange={onUploadingChange}
            onUploaded={(result) => {
              onClear(upload.path, hash.path, size.path)
              onPatch((current) => ({
                ...current,
                storage: result.storage,
                uploadId: result.uploadId,
                hash: result.hash,
                size: result.size
              }))
            }}
          />
          <FieldHint
            id={fieldErrorDomId(upload.path)}
            message={upload.message}
          />
        </>
      ) : null}
    </div>
  )
}
