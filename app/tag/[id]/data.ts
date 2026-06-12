import { cache } from 'react'
import { getTagById } from '~/app/api/tag/get'

export const getCachedTagById = cache(async (tagId: number) => {
  return getTagById({ tagId })
})
