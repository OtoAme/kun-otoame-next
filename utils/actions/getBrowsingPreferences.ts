'use server'

import { cache } from 'react'
import { getPageIdentity } from './getSessionIdentity'
import { readAccountBrowsingPreferences } from '~/app/api/utils/browsingPreferences'

export const getPageBrowsingPreferences = cache(async () => {
  const payload = await getPageIdentity()
  return payload
    ? readAccountBrowsingPreferences(payload.uid)
    : { mode: 'sfw', blockedTagIds: [] }
})
