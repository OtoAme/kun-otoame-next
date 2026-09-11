'use server'

import { z } from 'zod'
import { safeParseSchema } from '~/utils/actions/safeParseSchema'
import { getPatchByTag } from '~/app/api/tag/service'
import { getPatchVisibilityWhere } from '~/utils/actions/getPatchVisibilityWhere'
import { getPatchByTagSchema } from '~/validations/tag'

export const kunTagGalgameActions = async (
  params: z.infer<typeof getPatchByTagSchema>
) => {
  const input = safeParseSchema(getPatchByTagSchema, params)
  if (typeof input === 'string') {
    return input
  }

  const visibilityWhere = await getPatchVisibilityWhere()

  const response = await getPatchByTag(input, visibilityWhere)
  return response
}
