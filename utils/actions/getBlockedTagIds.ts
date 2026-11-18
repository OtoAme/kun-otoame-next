'use server'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { parseBlockedTagIds } from '~/utils/blockedTag'
import { getPageIdentity } from './getSessionIdentity'
import { prisma } from '~/prisma'

export const getBlockedTagIds = cache(async () => {
  const cookieStore = await cookies()
  const payload = await getPageIdentity()
  if (!payload) {
    return []
  }

  const cachedBlockedTagIds = cookieStore.get(
    'kun-patch-setting-store|state|data|kunBlockedTagIds'
  )?.value
  if (cachedBlockedTagIds !== undefined) {
    return parseBlockedTagIds(cachedBlockedTagIds)
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { blocked_tag_ids: true }
  })

  return user?.blocked_tag_ids ?? []
})
