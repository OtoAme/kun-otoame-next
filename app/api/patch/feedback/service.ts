import { z } from 'zod'
import { createPatchFeedbackSchema } from '~/validations/patch'

export const createFeedback = async (
  input: z.infer<typeof createPatchFeedbackSchema>,
  uid: number
) => {
  const { createCase } = await import('~/app/api/case/service')
  const result = await createCase(
    {
      kind: 'other',
      targetType: 'patch',
      targetId: input.patchId,
      content: input.content
    },
    uid
  )
  return typeof result === 'string' ? result : {}
}
