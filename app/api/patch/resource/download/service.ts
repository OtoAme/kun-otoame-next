import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { updatePatchResourceStatsSchema } from '~/validations/patch'

export const downloadStats = async (
  input: z.infer<typeof updatePatchResourceStatsSchema>
) => {
  // Auxiliary clicks stay on the link. Public download totals move only when
  // a grant transaction reveals a link, and raw SQL leaves updated untouched.
  const linkUpdateCount = await prisma.$executeRaw`
    UPDATE patch_resource_link
    SET click = click + 1
    WHERE id = ${input.linkId}
      AND resource_id = ${input.resourceId}
      AND EXISTS (
        SELECT 1
        FROM patch_resource
        INNER JOIN patch ON patch.id = patch_resource.patch_id
        WHERE patch_resource.id = patch_resource_link.resource_id
          AND patch_resource.patch_id = ${input.patchId}
          AND patch_resource.status = 0
          AND patch.status = 0
      )
  `

  if (Number(linkUpdateCount) !== 1) {
    return '未找到对应资源链接'
  }

  return {}
}
