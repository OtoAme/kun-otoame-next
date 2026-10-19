import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { patchResourceStableUpdateSchema } from '~/validations/patch'
import { workspaceResourceUpdateSchema } from '~/validations/workspace'
import { WORKSPACE_ERRORS } from '~/constants/workspace'
import type { WorkspaceResourceUpdateInput } from '~/types/api/workspace'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { closeLinkCases } from '~/app/api/case/linkHealth'
import {
  cleanupUploadedResourceDirs,
  compensateUploadedResources,
  deletePatchResourceCache,
  deletePatchResourceLink,
  finalizeUploadedResources,
  releaseUploadedResourceLocks,
  uploadPatchResource,
  updatePatchAttributes,
  type UploadedPatchResource
} from './_helper'
import { parseResourceLink } from '~/utils/resourceLink'
import { checkRelinkedResource } from './link-check/service'
import { lockLinkMaintenance } from './maintenance/service'
import {
  getLinkDisputeSources,
  projectLinkHealth
} from './linkHealthProjection'
import {
  lockResourceForMutation,
  resourceMutationInclude,
  resourcePostCommit,
  ResourceMutationError,
  runResourceMutation,
  type LockedResource
} from './mutation'
import type {
  PatchResourceStableUpdateRequest,
  PatchResourceStableUpdateResponse
} from '~/types/api/patch'

type LinkInput = PatchResourceStableUpdateRequest['links'][number]
type PrivateUpdatedResource = Omit<
  PatchResourceStableUpdateResponse,
  'links'
> & {
  links: (PatchResourceStableUpdateResponse['links'][number] & {
    content: string
    code: string
    password: string
  })[]
}
export type ResourceUpdateOptions = {
  onSaved?: (
    tx: Prisma.TransactionClient,
    before: LockedResource,
    after: PrivateUpdatedResource
  ) => Promise<void>
}
const conflict = () =>
  new ResourceMutationError(LINK_HEALTH_ERRORS.resource_conflict.message)
const editableFields = [
  'storage',
  'size',
  'code',
  'password',
  'hash',
  'content',
  'sort_order'
] as const
const linkSortOrders = (
  resource: LockedResource,
  input: PatchResourceStableUpdateRequest
) => {
  const retained = input.links.flatMap((link) =>
    link.id === undefined ? [] : [link.id]
  )
  const original = [...resource.links]
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .filter((link) => retained.includes(link.id))
    .map((link) => link.id)
  const lastExisting = input.links.findLastIndex(
    (link) => link.id !== undefined
  )
  const appendedOnly = input.links
    .slice(0, lastExisting + 1)
    .every((link) => link.id !== undefined)
  if (!appendedOnly || retained.some((id, index) => id !== original[index]))
    return input.links.map((_, index) => index)
  let nextOrder = Math.max(-1, ...resource.links.map((link) => link.sort_order))
  return input.links.map((link) => {
    if (link.id !== undefined)
      return resource.links.find((old) => old.id === link.id)?.sort_order ?? 0
    if (++nextOrder > 2147483647) throw conflict()
    return nextOrder
  })
}
const canonicalLink = (
  link: LinkInput,
  sortOrder: number,
  existing?: LockedResource['links'][number],
  uploaded?: UploadedPatchResource
) => {
  const parsed =
    link.storage === 's3'
      ? { url: link.content, code: '' }
      : parseResourceLink(link.content)
  return {
    storage: link.storage,
    size:
      uploaded?.size ??
      (existing?.storage === 's3' && link.storage === 's3' && !link.uploadId
        ? existing.size
        : link.size),
    hash:
      uploaded?.hash ??
      (existing?.storage === 's3' && link.storage === 's3' && !link.uploadId
        ? existing.hash
        : link.hash),
    content:
      uploaded?.downloadLink ??
      (existing?.storage === 's3' && link.storage === 's3' && !link.uploadId
        ? existing.content
        : parsed.url),
    code: link.code || parsed.code,
    password: link.password,
    sort_order: sortOrder
  }
}
const validateBaseAndPermissions = (
  resource: LockedResource,
  input: PatchResourceStableUpdateRequest,
  uid: number,
  role: number
) => {
  if (resource.patch_id !== input.patchId)
    throw new ResourceMutationError('资源不属于该 OtomeGame', 409)
  if (resource.user_id !== uid && role < 3)
    throw new ResourceMutationError('您没有权限更改该资源', 403)
  if (role < 3 && resource.status !== 0)
    throw new ResourceMutationError(
      WORKSPACE_ERRORS.resource_readonly.message,
      403
    )
  if (
    resource.links.length !== input.baseLinks.length ||
    resource.links.some(
      (link) =>
        !input.baseLinks.some(
          (base) => base.id === link.id && base.version === link.version
        )
    )
  )
    throw conflict()
  const ids = new Set(
    input.links.flatMap((link) => (link.id === undefined ? [] : [link.id]))
  )
  const orders = linkSortOrders(resource, input)
  const retainedOrder = [...resource.links]
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .filter((link) => ids.has(link.id))
    .map((link) => link.id)
  const desiredOrder = input.links.flatMap((link) =>
    link.id === undefined ? [] : [link.id]
  )
  for (const old of resource.links) {
    if (role < 3 && old.storage === 'touchgal') {
      const index = input.links.findIndex((link) => link.id === old.id)
      const next = input.links[index]
      if (
        !ids.has(old.id) ||
        !next ||
        next.uploadId ||
        ['storage', 'size', 'code', 'password', 'hash', 'content'].some(
          (key) => next[key as keyof LinkInput] !== old[key as keyof typeof old]
        ) ||
        retainedOrder.some(
          (id) =>
            id !== old.id &&
            retainedOrder.indexOf(id) < retainedOrder.indexOf(old.id) !==
              desiredOrder.indexOf(id) < desiredOrder.indexOf(old.id)
        ) ||
        orders[index] !== old.sort_order
      )
        throw new ResourceMutationError(
          LINK_HEALTH_ERRORS.forbidden.message,
          403
        )
    }
  }
  for (const link of input.links) {
    const old = resource.links.find((row) => row.id === link.id)
    if (link.id !== undefined && !old) throw conflict()
    if (role < 3 && link.storage === 'touchgal' && !old)
      throw new ResourceMutationError(LINK_HEALTH_ERRORS.forbidden.message, 403)
    if (role < 2 && link.storage === 's3')
      throw new ResourceMutationError('仅创作者和管理员可使用对象存储', 403)
    if (role < 3 && input.section === 'galgame' && link.storage === 's3')
      throw new ResourceMutationError('仅管理员可为游戏资源使用对象存储', 403)
    if (
      link.storage === 's3' &&
      !(old?.storage === 's3' && !link.uploadId) &&
      !link.uploadId
    )
      throw new ResourceMutationError('请先上传资源文件', 400)
    if (role < 3 && link.storage === 'touchgal' && old?.storage !== 'touchgal')
      throw new ResourceMutationError(LINK_HEALTH_ERRORS.forbidden.message, 403)
  }
}

const savePatchResource = async (
  submitted: PatchResourceStableUpdateRequest | WorkspaceResourceUpdateInput,
  uid: number,
  userRole: number,
  options: ResourceUpdateOptions = {},
  workspaceResourceId?: number
): Promise<PatchResourceStableUpdateResponse | string> => {
  const parsed =
    workspaceResourceId === undefined
      ? patchResourceStableUpdateSchema.safeParse(submitted)
      : workspaceResourceUpdateSchema.safeParse(submitted)
  if (!parsed.success) return LINK_HEALTH_ERRORS.invalid_request.message
  const resourceId =
    workspaceResourceId ??
    (parsed.data as PatchResourceStableUpdateRequest).resourceId
  const initial = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: resourceMutationInclude()
  })
  if (!initial)
    return workspaceResourceId === undefined
      ? '未找到该资源'
      : WORKSPACE_ERRORS.not_found.message
  const resolveInput = (
    resource: LockedResource
  ): PatchResourceStableUpdateRequest => {
    if (workspaceResourceId === undefined)
      return parsed.data as PatchResourceStableUpdateRequest
    if (resource.user_id !== uid)
      throw new ResourceMutationError(WORKSPACE_ERRORS.forbidden.message, 403)
    const workspace = parsed.data as WorkspaceResourceUpdateInput
    return {
      ...workspace,
      resourceId,
      patchId: resource.patch_id,
      links: workspace.links.map((link) => {
        const old = resource.links.find((row) => row.id === link.id)
        if ('storage' in link) {
          if (userRole < 3 && old?.storage === 'touchgal')
            throw new ResourceMutationError(
              WORKSPACE_ERRORS.forbidden.message,
              403
            )
          return link
        }
        if (!old || old.version !== link.version) throw conflict()
        if (userRole >= 3 || old.storage !== 'touchgal')
          throw new ResourceMutationError(
            WORKSPACE_ERRORS.forbidden.message,
            403
          )
        return {
          id: old.id,
          storage: old.storage,
          size: old.size,
          content: old.content,
          code: old.code,
          password: old.password,
          hash: old.hash
        }
      })
    }
  }
  let input: PatchResourceStableUpdateRequest
  try {
    input = resolveInput(initial)
    validateBaseAndPermissions(initial, input, uid, userRole)
  } catch (error) {
    if (error instanceof ResourceMutationError) return error.message
    throw error
  }
  const patchId = input.patchId
  const uploadedResources: UploadedPatchResource[] = []
  const uploadsByIndex = new Map<number, UploadedPatchResource>()
  let committed = false
  try {
    for (const [index, link] of input.links.entries()) {
      if (link.storage !== 's3' || !link.uploadId) continue
      const uploaded = await uploadPatchResource(patchId, link.uploadId, uid)
      if (typeof uploaded === 'string')
        throw new ResourceMutationError(uploaded, 400)
      uploadedResources.push(uploaded)
      uploadsByIndex.set(index, uploaded)
    }
    const now = new Date()
    const result = await runResourceMutation(async (tx) => {
      const before = await lockResourceForMutation(tx, resourceId, now)
      if (!before) throw new ResourceMutationError('未找到该资源', 404)
      const lockedInput = resolveInput(before)
      if (lockedInput.patchId !== patchId) throw conflict()
      const input = lockedInput
      validateBaseAndPermissions(before, input, uid, userRole)
      const orders = linkSortOrders(before, input)
      const actorType =
        userRole >= 3 ? ('staff' as const) : ('publisher' as const)
      const retainedIds = new Set(
        input.links.flatMap((link) => (link.id === undefined ? [] : [link.id]))
      )
      const removed = before.links.filter((link) => !retainedIds.has(link.id))
      const obsoleteS3 = new Set(
        removed
          .filter((link) => link.storage === 's3')
          .map((link) => link.content)
      )
      await lockLinkMaintenance(
        tx,
        before.links.map((link) => link.id)
      )
      const notificationBatch = new Set<number>()
      // All locks are already held in ID order before taking any case lock.
      if (removed.length) {
        for (const link of removed)
          await tx.patch_resource_link_history.create({
            data: {
              resource_id: resourceId,
              link_id: link.id,
              from_version: link.version,
              old_content: link.content,
              old_storage: link.storage,
              old_size: link.size,
              reason: 'remove',
              operator_user_id: uid,
              created: now
            }
          })
        await closeLinkCases(tx, {
          linkIds: removed.map((link) => link.id),
          resolution: 'link_removed',
          actorType,
          actorId: uid,
          notificationBatch,
          now
        })
        const deleted = await tx.patch_resource_link.deleteMany({
          where: {
            resource_id: resourceId,
            id: { in: removed.map((link) => link.id) }
          }
        })
        if (deleted.count !== removed.length) throw conflict()
      }
      for (const [index, link] of input.links.entries()) {
        const old = before.links.find((row) => row.id === link.id)
        const next =
          userRole < 3 && old?.storage === 'touchgal'
            ? {
                storage: old.storage,
                size: old.size,
                hash: old.hash,
                content: old.content,
                code: old.code,
                password: old.password,
                sort_order: old.sort_order
              }
            : canonicalLink(link, orders[index], old, uploadsByIndex.get(index))
        if (!old) {
          await tx.patch_resource_link.create({
            data: { ...next, resource_id: resourceId }
          })
          continue
        }
        const data: Prisma.patch_resource_linkUpdateManyMutationInput = {}
        for (const key of editableFields)
          if (next[key] !== old[key]) data[key] = next[key] as never
        const relinked = next.content !== old.content
        if (relinked) {
          if (old.version === 2147483647) throw conflict()
          await closeLinkCases(tx, {
            targets: [{ linkId: old.id, linkVersion: old.version }],
            resolution: 'relinked',
            actorType,
            actorId: uid,
            notificationBatch,
            now
          })
          await tx.patch_resource_link_history.create({
            data: {
              resource_id: resourceId,
              link_id: old.id,
              from_version: old.version,
              old_content: old.content,
              old_storage: old.storage,
              old_size: old.size,
              reason: 'relink',
              operator_user_id: uid,
              created: now
            }
          })
          Object.assign(data, {
            version: old.version + 1,
            evidence_round: 0,
            health: 'ok',
            verified_at: null,
            health_changed_at:
              old.health === 'ok' ? old.health_changed_at : now,
            content_changed_at: now
          })
        }
        if (Object.keys(data).length) {
          const updated = await tx.patch_resource_link.updateMany({
            where: {
              id: old.id,
              resource_id: resourceId,
              version: old.version
            },
            data
          })
          if (updated.count !== 1) throw conflict()
        }
        if (
          old.storage === 's3' &&
          (next.storage !== 's3' || next.content !== old.content)
        )
          obsoleteS3.add(old.content)
      }
      await tx.patch_resource.update({
        where: { id: resourceId },
        data: {
          section: input.section,
          name: input.name,
          note: input.note,
          type: input.type,
          language: input.language,
          platform: input.platform
        }
      })
      const uniqueId = await updatePatchAttributes(patchId, tx)
      const fresh = await tx.patch_resource.findUniqueOrThrow({
        where: { id: resourceId },
        include: resourceMutationInclude(now)
      })
      const disputes = await getLinkDisputeSources(
        fresh.links.map((link) => ({ ...link, resourceId, patchId })),
        tx
      )
      const response: PatchResourceStableUpdateResponse = {
        id: fresh.id,
        name: fresh.name,
        section: fresh.section,
        uniqueId: fresh.patch.unique_id,
        patchName: fresh.patch.name,
        type: fresh.type,
        language: fresh.language,
        platform: fresh.platform,
        note: fresh.note,
        links: [...fresh.links]
          .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
          .map((link) => ({
            ...projectLinkHealth(
              link,
              fresh.user_id,
              { uid, role: userRole },
              disputes.get(link.id) ?? null,
              now
            ),
            id: link.id,
            storage: link.storage,
            size: link.size,
            hash: link.hash,
            sortOrder: link.sort_order,
            download: link.download
          })),
        download: fresh.download,
        likeCount: 0,
        isLike: false,
        status: fresh.status,
        userId: fresh.user_id,
        patchId: fresh.patch_id,
        created: fresh.created.toISOString(),
        user: {
          id: fresh.user.id,
          name: fresh.user.name,
          avatar: fresh.user.avatar,
          role: fresh.user.role,
          patchCount: fresh.user._count.patch_resource
        },
        linkChecks: []
      }
      if (options.onSaved)
        await options.onSaved(tx, before, {
          ...response,
          links: response.links.map((link) => {
            const source = fresh.links.find((row) => row.id === link.id)!
            return {
              ...link,
              content: source.content,
              code: source.code,
              password: source.password
            }
          })
        })
      return { response, uniqueId, obsoleteS3: [...obsoleteS3] }
    })
    committed = true
    const context = { userId: uid, patchId, resourceId }
    await resourcePostCommit('upload-finalize', () =>
      finalizeUploadedResources(uploadedResources, context)
    )
    await resourcePostCommit('upload-directory-cleanup', () =>
      cleanupUploadedResourceDirs(uploadedResources, context)
    )
    for (const content of result.obsoleteS3)
      await resourcePostCommit('obsolete-resource-object', () =>
        deletePatchResourceLink(content)
      )
    await resourcePostCommit('resource-cache', () =>
      deletePatchResourceCache(result.uniqueId)
    )
    return checkRelinkedResource(result.response, input.baseLinks, {
      uid,
      role: userRole
    })
  } catch (error) {
    if (!committed) {
      // Content-addressed uploads can replace an already referenced object.
      // A failed edit must never compensate by deleting that live object.
      const unreferenced: UploadedPatchResource[] = []
      for (const uploaded of uploadedResources) {
        try {
          if (
            (await prisma.patch_resource_link.count({
              where: { content: uploaded.downloadLink }
            })) === 0
          )
            unreferenced.push(uploaded)
        } catch {
          console.error('[Resource] Upload compensation reference check failed')
        }
      }
      await compensateUploadedResources(unreferenced)
      await releaseUploadedResourceLocks(uploadedResources)
    }
    if (error instanceof ResourceMutationError) return error.message
    throw error
  }
}

export const updatePatchResource = (
  submitted: PatchResourceStableUpdateRequest,
  uid: number,
  userRole: number,
  options: ResourceUpdateOptions = {}
) => savePatchResource(submitted, uid, userRole, options)

export const updateWorkspacePatchResource = (
  resourceId: number,
  submitted: WorkspaceResourceUpdateInput,
  uid: number,
  userRole: number
) => savePatchResource(submitted, uid, userRole, {}, resourceId)
