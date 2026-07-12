import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { restorePatchResourceLinksSchema } from '~/validations/patch'
import {
  getResourceAccessActorKey,
  getResourceAccessActorWhere
} from '../actor'
import type { Prisma } from '@prisma/client'
import type { ResourceAccessActor } from '../actor'
import type { PatchResourceAccessRestoreResponse } from '~/types/api/patch'

type RestoreInput = z.infer<typeof restorePatchResourceLinksSchema>

export const restorePatchResourceLinks = async (
  input: RestoreInput,
  visibilityWhere: Prisma.patchWhereInput,
  actor: ResourceAccessActor,
  now = new Date()
): Promise<PatchResourceAccessRestoreResponse> => {
  const actorKey = getResourceAccessActorKey(actor)
  const grant = await prisma.patch_resource_access_grant.findUnique({
    where: {
      actor_key_resource_id: {
        actor_key: actorKey,
        resource_id: input.resourceId
      }
    },
    select: { expires: true }
  })

  if (!grant || grant.expires <= now) {
    return { links: [], obtainedExpiresAt: null }
  }

  const access = await prisma.patch_resource_access.findMany({
    where: {
      ...getResourceAccessActorWhere(actor),
      patch_id: input.patchId,
      resource_id: input.resourceId,
      link_id: { in: input.linkIds },
      expires: { gte: grant.expires },
      link: { resource_id: input.resourceId },
      resource: {
        status: 0,
        patch_id: input.patchId,
        patch: { id: input.patchId, status: 0, ...visibilityWhere }
      }
    },
    select: {
      link: {
        select: {
          id: true,
          storage: true,
          size: true,
          content: true,
          code: true,
          password: true,
          hash: true
        }
      }
    }
  })

  const linkById = new Map(access.map(({ link }) => [link.id, link]))
  return {
    links: input.linkIds.flatMap((id) => {
      const link = linkById.get(id)
      return link ? [link] : []
    }),
    obtainedExpiresAt: grant.expires.toISOString()
  }
}
