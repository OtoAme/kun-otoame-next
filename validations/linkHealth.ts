import { z } from 'zod'
import {
  LINK_CHECK_PROVIDERS,
  LINK_CHECK_REASONS,
  LINK_CASE_RESOLUTIONS,
  LINK_DISPUTE_SOURCES,
  LINK_HEALTH_POLICY,
  LINK_HEALTH_ERRORS,
  LINK_HEALTH_OWNER_ACTIONS,
  LINK_HEALTH_RESOLVE_ACTIONS,
  LINK_HEALTH_STATES
} from '~/constants/linkHealth'

export const linkHealthIdSchema = z.number().int().positive().max(2147483647)
export const linkVersionSchema = linkHealthIdSchema
export const linkEvidenceRoundSchema = z.number().int().min(0).max(2147483647)
export const linkVersionBaseSchema = z
  .object({ id: linkHealthIdSchema, version: linkVersionSchema })
  .strict()

export const linkTargetSchema = z
  .object({
    patchId: linkHealthIdSchema,
    resourceId: linkHealthIdSchema,
    linkId: linkHealthIdSchema,
    linkVersion: linkVersionSchema
  })
  .strict()

export const linkHealthBasisSchema = linkTargetSchema
  .extend({
    evidenceRound: linkEvidenceRoundSchema,
    health: z.enum(LINK_HEALTH_STATES),
    healthChangedAt: z.string().datetime().nullable()
  })
  .strict()

const networkAcknowledged = z.literal(true, {
  errorMap: () => ({
    message: LINK_HEALTH_ERRORS.network_confirmation_required.message
  })
})

/** Clients submit a version, never a weight, identity, URL or checker result. */
export const linkReportSchema = z.discriminatedUnion('reason', [
  linkTargetSchema.extend({
    reason: z.literal('deleted'),
    networkAcknowledged: networkAcknowledged.optional()
  }),
  linkTargetSchema.extend({
    reason: z.literal('access_condition'),
    networkAcknowledged: networkAcknowledged.optional()
  }),
  linkTargetSchema.extend({
    reason: z.literal('unreachable'),
    networkAcknowledged
  })
])

/** All basis fields are expectations, rechecked in the write transaction. */
export const linkHealthActionSchema = linkHealthBasisSchema.extend({
  action: z.enum(LINK_HEALTH_OWNER_ACTIONS)
})
export const linkHealthResolveSchema = linkHealthBasisSchema.extend({
  health: z.literal('disputed'),
  action: z.enum(LINK_HEALTH_RESOLVE_ACTIONS)
})
export const linkCheckRequestSchema = linkHealthBasisSchema

const page = z.coerce.number().int().min(1).max(2147483647).default(1)
const limit = z.coerce.number().int().min(1).max(50).default(20)
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

export const linkHealthQuerySchema = z.object({ page, limit }).strict()

export const adminLinkHealthQuerySchema = z
  .object({
    page,
    limit,
    ownerType: z.enum(['publisher', 'staff']).optional(),
    hasTouchgalLink: queryBoolean.optional(),
    // Exact host bucket (lowercase); null/invalid hosts use the other bucket.
    hostname: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)
      .optional(),
    otherHost: queryBoolean.optional(),
    minBrokenDays: z.coerce.number().int().min(0).max(36500).optional()
  })
  .strict()
  .refine((value) => !(value.hostname && value.otherHost), {
    message: '请选择主机名或其他主机分组',
    path: ['hostname']
  })

/** Decode durable system-message context before using it to drive tasks. */
export const linkCaseContextSchema = z.discriminatedUnion('source', [
  linkHealthBasisSchema.extend({
    health: z.literal('suspect'),
    source: z.literal('user_reports')
  }),
  linkHealthBasisSchema.extend({
    health: z.literal('disputed'),
    source: z.literal('owner_verification')
  }),
  linkHealthBasisSchema.extend({
    health: z.literal('disputed'),
    source: z.literal('machine_user_conflict'),
    machine: z
      .object({
        provider: z.enum(LINK_CHECK_PROVIDERS),
        reason: z.literal('share_available'),
        checkedAt: z.string().datetime()
      })
      .strict()
  })
])

const checkProvider = z.enum(LINK_CHECK_PROVIDERS)
const checkUnknownReason = z.enum([
  'access_unverified',
  'unsupported',
  'rate_limited',
  'timeout',
  'unavailable',
  'invalid_response',
  'untrusted_result'
])
const checkIdentity = z
  .object({
    requestId: z.string().uuid(),
    basis: linkHealthBasisSchema,
    inputSignature: z.string().regex(/^[0-9a-f]{64}$/),
    requestedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    cached: z.boolean()
  })
  .strict()

/** Decode persisted snapshots rather than trusting a database cast. */
export const linkCheckSnapshotSchema = z
  .discriminatedUnion('verdict', [
    checkIdentity.extend({
      verdict: z.literal('available'),
      provider: checkProvider,
      reason: z.literal('share_available'),
      failed: z.literal(false),
      checkedAt: z.string().datetime()
    }),
    checkIdentity.extend({
      verdict: z.literal('broken'),
      provider: checkProvider,
      reason: z.enum([
        'share_deleted',
        'share_cancelled',
        'share_expired',
        'share_blocked'
      ]),
      failed: z.literal(false),
      checkedAt: z.string().datetime()
    }),
    checkIdentity.extend({
      verdict: z.literal('unknown'),
      provider: checkProvider.nullable(),
      reason: checkUnknownReason,
      failed: z.boolean(),
      checkedAt: z.string().datetime().nullable()
    })
  ])
  .superRefine((value, ctx) => {
    const requested = Date.parse(value.requestedAt)
    const completed = Date.parse(value.completedAt)
    if (completed < requested || value.failed !== (value.checkedAt === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '检测快照时间或结果不一致'
      })
    }
    if (
      value.checkedAt !== null &&
      Date.parse(value.checkedAt) >
        completed + LINK_HEALTH_POLICY.checkClockSkewMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '检测观察时间晚于本次完成时间'
      })
    }
    if (!value.failed && value.checkedAt) {
      const checked = Date.parse(value.checkedAt)
      if (
        completed - requested > LINK_HEALTH_POLICY.checkBudgetMs ||
        (value.cached
          ? completed - checked > LINK_HEALTH_POLICY.checkCacheMaxAgeMs
          : checked < requested - LINK_HEALTH_POLICY.checkClockSkewMs) ||
        (value.basis.healthChangedAt !== null &&
          checked < Date.parse(value.basis.healthChangedAt))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '检测快照不属于本次有效观察'
        })
      }
    }
  })

export const linkHealthTransitionRecordSchema = z
  .object({
    from: linkHealthBasisSchema,
    to: z
      .object({
        evidenceRound: linkEvidenceRoundSchema,
        health: z.enum(LINK_HEALTH_STATES),
        healthChangedAt: z.string().datetime()
      })
      .strict(),
    cause: z.enum([
      'user_reports',
      ...LINK_DISPUTE_SOURCES,
      ...Object.keys(LINK_CASE_RESOLUTIONS)
    ] as [string, ...string[]]),
    machine: z
      .object({
        provider: checkProvider.nullable(),
        reason: z.enum(LINK_CHECK_REASONS),
        checkedAt: z.string().datetime().nullable()
      })
      .strict()
      .nullable()
  })
  .strict()
  .superRefine((value, ctx) => {
    const expectedRound =
      value.from.evidenceRound +
      (value.from.health === 'ok' && value.to.health === 'suspect' ? 0 : 1)
    if (
      value.from.health === value.to.health ||
      value.to.evidenceRound !== expectedRound
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '健康转换轮次不一致'
      })
    }
  })
