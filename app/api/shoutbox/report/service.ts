import type { PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { createCase } from '~/app/api/case/service'
import type { shoutboxReportSchema } from '~/validations/shoutbox'

type ShoutboxReportInput = z.infer<typeof shoutboxReportSchema>

export const createReport = async (
  input: ShoutboxReportInput,
  userId: number,
  options: { now?: Date; db?: PrismaClient } = {}
) => {
  const result = await createCase(
    {
      kind: 'content_violation',
      targetType: 'shoutbox',
      targetId: input.shoutboxId,
      content: input.content
    },
    userId,
    { now: options.now, db: options.db }
  )
  return typeof result === 'string' ? result : {}
}
