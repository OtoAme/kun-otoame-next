import { z } from 'zod'
import { createPatchRatingReportSchema } from '~/validations/patch'

export const createReport = async (
  input: z.infer<typeof createPatchRatingReportSchema>,
  uid: number
) => {
  const { createCase } = await import('~/app/api/case/service')
  const result = await createCase(
    {
      kind: 'content_violation',
      targetType: 'rating',
      targetId: input.ratingId,
      expectedPatchId: input.patchId,
      content: input.content
    },
    uid
  )
  return typeof result === 'string' ? result : {}
}
