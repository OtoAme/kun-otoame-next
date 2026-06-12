'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { getPatchByCompany } from '~/app/api/company/service'
import { getPatchByCompanySchema } from '~/validations/company'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'

export const kunCompanyGalgameActions = async (
  params: z.input<typeof getPatchByCompanySchema>
) => {
  const input = safeParseSchema(getPatchByCompanySchema, params)
  if (typeof input === 'string') {
    return input
  }

  const visibilityWhere = await getPatchVisibilityWhere()

  const response = await getPatchByCompany(input, visibilityWhere)
  return response
}
