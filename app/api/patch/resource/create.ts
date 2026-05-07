import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { patchResourceCreateSchema } from '~/validations/patch'
import { createMessage } from '~/app/api/utils/message'
import {
  deletePatchResourceCache,
  updatePatchAttributes,
  uploadPatchResource
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

export const createPatchResource = async (
  input: z.infer<typeof patchResourceCreateSchema>,
  uid: number,
  userRole: number
) => {
  const { patchId, type, language, platform, links, section, ...resourceData } =
    input

  const currentPatch = await prisma.patch.findUnique({
    where: { id: patchId },
    select: {
      unique_id: true,
      name: true
    }
  })

  const resourceCount = await prisma.patch_resource.count({
    where: { user_id: uid }
  })
  const needApproval = userRole === 1 || (userRole === 2 && resourceCount === 0)

  const preparedLinks: PreparedResourceLink[] = []
  for (const [index, link] of links.entries()) {
    let content = link.content
    let code = link.code

    if (link.storage === 's3') {
      const result = await uploadPatchResource(patchId, link.hash)
      if (typeof result === 'string') {
        return result
      }
      content = result.downloadLink
    } else {
      const parsedLink = parseResourceLink(content)
      content = parsedLink.url
      code = code || parsedLink.code
    }

    preparedLinks.push({
      storage: link.storage,
      size: link.size,
      code,
      password: link.password,
      hash: link.hash,
      content,
      sort_order: index,
      download: 0
    })
  }

  const resourceTypeName = section === 'galgame' ? '游戏资源' : '补丁资源'

  const { resource, uniqueIdToClear } = await prisma.$transaction(
    async (prisma) => {
      const newResource = await prisma.patch_resource.create({
        data: {
          patch_id: patchId,
          user_id: uid,
          type,
          language,
          platform,
          section,
          status: needApproval ? 2 : 0,
          ...resourceData,
          links: {
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
          links: {
            orderBy: { sort_order: 'asc' }
          }
        }
      })

      await prisma.user.update({
        where: { id: uid },
        data: { moemoepoint: { increment: 3 } }
      })

      const uniqueIdToClear =
        currentPatch && !needApproval
          ? await updatePatchAttributes(patchId, prisma)
          : null

      const resource: PatchResource = {
        id: newResource.id,
        name: newResource.name,
        section: newResource.section,
        uniqueId: currentPatch?.unique_id ?? '',
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

      return { resource, uniqueIdToClear }
    }
  )

  if (uniqueIdToClear) {
    await deletePatchResourceCache(uniqueIdToClear)
  }

  if (needApproval) {
    const approvalMessage =
      userRole === 1
        ? `你的${resourceTypeName}「${currentPatch?.name ?? ''}」已提交审核，审核通过后将自动公开显示。`
        : `你的第一个${resourceTypeName}「${currentPatch?.name ?? ''}」已提交审核，审核通过后将自动公开显示。`
    await createMessage({
      type: 'system',
      content: approvalMessage,
      recipient_id: uid,
      link: currentPatch?.unique_id ? `/${currentPatch.unique_id}` : '/'
    })
  }

  if (userRole < 3) {
    const admins = await prisma.user.findMany({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    const patchLink = currentPatch?.unique_id
      ? `/${currentPatch.unique_id}`
      : '/'
    await Promise.all(
      admins.map((admin) =>
        createMessage({
          type: 'system',
          content: needApproval
            ? `用户发布${resourceTypeName}「${resource.name}」于「${currentPatch?.name ?? ''}」，请前往审核。`
            : `用户发布了${resourceTypeName}「${resource.name}」于「${currentPatch?.name ?? ''}」，请留意审查。`,
          sender_id: uid,
          recipient_id: admin.id,
          link: needApproval ? '/admin/resource-apply' : patchLink
        })
      )
    )
  }

  return resource
}
