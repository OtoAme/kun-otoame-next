import type { Prisma } from '@prisma/client'

export const getProfileResourceWhere = (visibility: Prisma.patchWhereInput) => ({
  status: 0,
  patch: visibility
})
