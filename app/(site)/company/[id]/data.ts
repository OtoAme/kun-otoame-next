import { cache } from 'react'
import { getCompanyById } from '~/app/api/company/service'

export const getCachedCompanyById = cache(async (companyId: number) => {
  return getCompanyById({ companyId })
})
