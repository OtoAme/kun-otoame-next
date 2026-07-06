import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { accessPatchResourceLinkSchema } from '~/validations/patch'
import { RESOURCE_ACCESS_REUSE_MS } from './actor'
import type { Prisma } from '@prisma/client'
import type { ResourceAccessActor } from './actor'
import type { PatchResourceAccessResponse } from '~/types/api/patch'

export const accessPatchResourceLink = async (
  input: z.infer<typeof accessPatchResourceLinkSchema>,
  visibilityWhere: Prisma.patchWhereInput,
  actor: ResourceAccessActor
): Promise<PatchResourceAccessResponse | string> => {
  const link = await prisma.patch_resource_link.findFirst({
    where: {
      id: input.linkId,
      resource_id: input.resourceId,
      resource: {
        id: input.resourceId,
        patch_id: input.patchId,
        status: 0,
        patch: {
          id: input.patchId,
          status: 0,
          ...visibilityWhere
        }
      }
    },
    select: {
      id: true,
      storage: true,
      size: true,
      content: true,
      code: true,
      password: true,
      hash: true,
      resource: {
        select: {
          id: true,
          section: true,
          patch_id: true
        }
      }
    }
  })

  if (!link) {
    return '未找到对应资源链接'
  }

  const now = new Date()
  const accessWhere =
    actor.actorType === 'user'
      ? {
          user_id: actor.uid,
          link_id: link.id,
          expires: { gt: now }
        }
      : {
          visitor_token: actor.visitorToken,
          link_id: link.id,
          expires: { gt: now }
        }

  const existingAccess = await prisma.patch_resource_access.findFirst({
    where: accessWhere,
    select: {
      expires: true
    },
    orderBy: { expires: 'desc' }
  })
  const reused = Boolean(existingAccess)
  const access = existingAccess
    ? existingAccess
    : await prisma.patch_resource_access.create({
        data: {
          actor_type: actor.actorType,
          user_id: actor.actorType === 'user' ? actor.uid : null,
          visitor_token:
            actor.actorType === 'visitor' ? actor.visitorToken : '',
          patch_id: input.patchId,
          resource_id: input.resourceId,
          link_id: link.id,
          section: link.resource.section,
          storage: link.storage,
          cost: 0,
          expires: new Date(now.getTime() + RESOURCE_ACCESS_REUSE_MS)
        }
      })

  const { resource: _resource, ...safeLink } = link

  return {
    link: safeLink,
    access: {
      actorType: actor.actorType,
      cost: 0,
      reused,
      obtainedExpiresAt: access.expires.toISOString()
    }
  }
}
