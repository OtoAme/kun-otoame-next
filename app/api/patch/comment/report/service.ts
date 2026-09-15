import { z } from 'zod'
import { createPatchCommentReportSchema } from '~/validations/patch'

export const createReport = async (
  input: z.infer<typeof createPatchCommentReportSchema>,
  uid: number
) => {
  const { createCase } = await import('~/app/api/case/service')
  const result = await createCase(
    {
      kind: 'content_violation',
      targetType: 'comment',
      targetId: input.commentId,
      expectedPatchId: input.patchId,
      content: input.content
    },
    uid
  )
  return typeof result === 'string' ? result : {}
}
