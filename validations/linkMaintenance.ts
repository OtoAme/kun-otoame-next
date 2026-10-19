import { z } from 'zod'
import {
  LINK_MAINTENANCE_NOTE_MAX,
  LINK_MAINTENANCE_SNOOZE_DAYS
} from '~/constants/linkMaintenance'
import {
  linkTargetSchema,
  linkEvidenceRoundSchema,
  linkHealthBasisSchema
} from './linkHealth'
import type { LinkMaintenanceActionInput } from '~/types/api/linkMaintenance'

const target = linkTargetSchema
  .extend({ maintenanceRevision: linkEvidenceRoundSchema })
  .strict()
const note = z.string().trim().min(1).max(LINK_MAINTENANCE_NOTE_MAX)
export const linkMaintenanceActionSchema = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('respond'), note }),
  target.extend({
    action: z.literal('verify'),
    note,
    basis: linkHealthBasisSchema
  }),
  target.extend({
    action: z.literal('snooze'),
    days: z.union([
      z.literal(LINK_MAINTENANCE_SNOOZE_DAYS[0]),
      z.literal(LINK_MAINTENANCE_SNOOZE_DAYS[1])
    ])
  }),
  target.extend({ action: z.literal('stop'), note }),
  target.extend({ action: z.literal('resume') })
]) satisfies z.ZodType<LinkMaintenanceActionInput, z.ZodTypeDef, unknown>
