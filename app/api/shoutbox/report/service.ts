import type { PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { createShoutboxReport } from '~/app/api/shoutbox/service'
import type { shoutboxReportSchema } from '~/validations/shoutbox'

type ShoutboxReportInput = z.infer<typeof shoutboxReportSchema>

export const createReport = (
  input: ShoutboxReportInput,
  userId: number,
  options: { now?: Date; db?: PrismaClient } = {}
) => createShoutboxReport(input, userId, options)
