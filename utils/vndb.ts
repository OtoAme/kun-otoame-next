'use client'

import { kunFetchPost } from '~/utils/kunFetch'
import type { VndbDetailsResponse } from '~/types/api/externalCompanyData'

export const fetchVNDBDetails = async (
  vnId: string
): Promise<VndbDetailsResponse> => {
  const response = await kunFetchPost<VndbDetailsResponse | string>(
    '/edit/vndb/details',
    { vndbId: vnId }
  )

  if (typeof response === 'string') {
    if (response === '未找到对应的 VNDB 条目') {
      throw new Error('VNDB_NOT_FOUND')
    }
    throw new Error('VNDB_API_ERROR')
  }

  return response
}
