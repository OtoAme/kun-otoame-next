'use server'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { getPageIdentity } from './getSessionIdentity'
import { getContentLimitWhere } from '~/utils/contentPreference'

export const getNSFWHeader = cache(async () => {
  const payload = await getPageIdentity()
  if (!payload) {
    return { content_limit: 'sfw' }
  }
  const cookieStore = await cookies()
  return getContentLimitWhere(
    cookieStore.get('kun-patch-setting-store|state|data|kunNsfwEnable')?.value
  )
})
