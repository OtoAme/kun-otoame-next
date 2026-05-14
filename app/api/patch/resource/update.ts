import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { patchResourceUpdateSchema } from '~/validations/patch'
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
import type { PatchResource } from '~/types/api/patch'

type PreparedResourceLink = {
  storage: string
  size: string
  code: string
  password: string
  hash: string
  content: string
  sort_order: number
  download: number
}

export const updatePatchResource = async (
  input: z.infer<typeof patchResourceUpdateSchema>,
  uid: number,
  userRole: number
) => {
  const { resourceId, patchId, links, ...resourceData } = input
  const resource = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: {
      links: {
        orderBy: { sort_order: 'asc' }
      }
    }
  })
  if (!resource) {
    return '未找到该资源'
  }

  const resourceUserUid = resource.user_id
  if (resource.user_id !== uid && userRole < 3) {
    return '您没有权限更改该资源'
  }

  const currentPatch = await prisma.patch.findUnique({
    where: { id: patchId },
    select: {
      name: true,
      type: true,
      language: true,
      platform: true
    }
  })
  if (!currentPatch) {
    return '未找到该资源对应的 OtomeGame 信息, 请确认 OtomeGame 存在'
  }

  const existingLinksById = new Map(
    resource.links.map((link) => [link.id, link])
  )
  const nextLinkIds = new Set(
    links
      .map((link) => link.id)
      .filter((id): id is number => typeof id === 'number')
  )
  const linksToDelete = resource.links.filter(
    (link) => !nextLinkIds.has(link.id)
  )
  const s3LinksToDelete: { id: number; content: string; storage: string }[] = []
  const preparedLinks: PreparedResourceLink[] = []
  const uploadedResources: UploadedPatchResource[] = []
  let dbCommitted = false

  for (const removedLink of linksToDelete) {
    if (removedLink.storage === 's3') {
      s3LinksToDelete.push(removedLink)
    }
  }

  try {
    for (const [index, link] of links.entries()) {
      const existingLink =
        typeof link.id === 'number' ? existingLinksById.get(link.id) : null
      if (typeof link.id === 'number' && !existingLink) {
        await compensateUploadedResources(uploadedResources)
        await releaseUploadedResourceLocks(uploadedResources)
        return '资源链接不存在或不属于该资源'
      }

      let content = link.content
      let code = link.code
      let hash = link.hash
      let size = link.size
      const download = existingLink?.download ?? 0

      if (link.storage === 's3') {
        if (existingLink && existingLink.storage === 's3' && !link.uploadId) {
          content = existingLink.content
          hash = existingLink.hash
          size = existingLink.size
        } else {
          if (!link.uploadId) {
            await compensateUploadedResources(uploadedResources)
            await releaseUploadedResourceLocks(uploadedResources)
            return '请先上传资源文件'
          }

          const result = await uploadPatchResource(patchId, link.uploadId!, uid)
          if (typeof result === 'string') {
            await compensateUploadedResources(uploadedResources)
            await releaseUploadedResourceLocks(uploadedResources)
            return result
          }

          uploadedResources.push(result)
          content = result.downloadLink
          hash = result.hash
          size = result.size

          if (existingLink?.storage === 's3') {
            s3LinksToDelete.push(existingLink)
          }
        }
      } else {
        const parsedLink = parseResourceLink(content)
        content = parsedLink.url
        code = code || parsedLink.code

        if (existingLink?.storage === 's3') {
          s3LinksToDelete.push(existingLink)
        }
      }

      preparedLinks.push({
        storage: link.storage,
        size,
        code,
        password: link.password,
        hash,
        content,
        sort_order: index,
        download
      })
    }

    const { resourceResponse, uniqueId } = await prisma.$transaction(
      async (prisma) => {
        const newResource = await prisma.patch_resource.update({
          where: { id: resourceId, user_id: resourceUserUid },
          data: {
            ...resourceData,
            links: {
              deleteMany: {},
              create: preparedLinks
            }
          },
          include: {
            user: {
              include: {
                _count: {
                  select: { patch_resource: true }
                }
              }
            },
            patch: {
              select: {
                unique_id: true
              }
            },
            links: {
              orderBy: { sort_order: 'asc' }
            }
          }
        })

        const uniqueId = await updatePatchAttributes(patchId, prisma)

        const resourceResponse: PatchResource = {
          id: newResource.id,
          name: newResource.name,
          section: newResource.section,
          uniqueId: newResource.patch.unique_id,
          type: newResource.type,
          language: newResource.language,
          note: newResource.note,
          platform: newResource.platform,
          links: newResource.links.map((link) => ({
            id: link.id,
            storage: link.storage,
            size: link.size,
            code: link.code,
            password: link.password,
            hash: link.hash,
            content: link.content,
            sortOrder: link.sort_order,
            download: link.download
          })),
          download: newResource.download,
          likeCount: 0,
          isLike: false,
          status: newResource.status,
          userId: newResource.user_id,
          patchId: newResource.patch_id,
          created: String(newResource.created),
          user: {
            id: newResource.user.id,
            name: newResource.user.name,
            avatar: newResource.user.avatar,
            patchCount: newResource.user._count.patch_resource,
            role: newResource.user.role
          }
        }

        return { resourceResponse, uniqueId }
      }
    )
    dbCommitted = true

    await finalizeUploadedResources(uploadedResources, {
      userId: uid,
      patchId,
      resourceId
    })
    await cleanupUploadedResourceDirs(uploadedResources, {
      userId: uid,
      patchId,
      resourceId
    })

    const deletedContents = Array.from(
      new Set(s3LinksToDelete.map((link) => link.content))
    )
    for (const content of deletedContents) {
      try {
        await deletePatchResourceLink(content)
      } catch (error) {
        console.error('[Upload] Failed to delete old S3 object after update', {
          content,
          resourceId,
          patchId,
          error
        })
      }
    }

    await deletePatchResourceCache(uniqueId)

    return resourceResponse
  } catch (error) {
    if (!dbCommitted) {
      await compensateUploadedResources(uploadedResources)
      await releaseUploadedResourceLocks(uploadedResources)
    }
    throw error
  }
}
