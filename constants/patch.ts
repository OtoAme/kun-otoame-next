import type { Prisma } from '@prisma/client'

export const PATCH_STATUS_VISIBLE = 0
export const PATCH_STATUS_PUBLISHING = 1

export const VISIBLE_PATCH_WHERE = {
  status: PATCH_STATUS_VISIBLE
} satisfies Prisma.patchWhereInput

export const withVisiblePatchWhere = (
  where: Prisma.patchWhereInput = {}
): Prisma.patchWhereInput => ({
  ...where,
  ...VISIBLE_PATCH_WHERE
})
