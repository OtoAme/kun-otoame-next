import { z } from 'zod'
import {
  WORKSPACE_ENTRY_VIEWS,
  WORKSPACE_MAINTENANCE_VIEWS,
  WORKSPACE_RESOURCE_STATUSES,
  WORKSPACE_SECTIONS,
  WORKSPACE_PAGE_LIMIT,
  WORKSPACE_MAX_PAGE_LIMIT
} from '~/constants/workspace'
import { PATCH_SUBMISSION_STATUSES } from '~/types/api/patchSubmission'
import { linkHealthIdSchema, linkVersionBaseSchema } from './linkHealth'
import {
  patchResourceLinkSchema,
  patchResourceSchemaBase,
  validateResourceTypesBySection,
  validateResourcePlatformsByType,
  validateChineseSupportByType
} from './patch'
import type {
  WorkspaceEntriesQuery,
  WorkspaceResourcesQuery,
  WorkspaceMaintenanceQuery,
  WorkspaceResourceUpdateInput
} from '~/types/api/workspace'

const pagination = {
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKSPACE_MAX_PAGE_LIMIT)
    .default(WORKSPACE_PAGE_LIMIT),
  query: z.string().trim().max(300).optional()
}
export const workspaceEntriesQuerySchema = z
  .object({
    ...pagination,
    view: z.enum(WORKSPACE_ENTRY_VIEWS).default('submissions'),
    status: z.enum(['all', ...PATCH_SUBMISSION_STATUSES]).default('all')
  })
  .strict()
  .refine((value) => value.view !== 'published' || value.status === 'all', {
    message: '已发布条目不支持投稿状态筛选',
    path: ['status']
  }) satisfies z.ZodType<WorkspaceEntriesQuery, z.ZodTypeDef, unknown>

export const workspaceResourcesQuerySchema = z
  .object({
    ...pagination,
    status: z.enum(WORKSPACE_RESOURCE_STATUSES).default('all'),
    section: z.enum(WORKSPACE_SECTIONS).default('all')
  })
  .strict() satisfies z.ZodType<WorkspaceResourcesQuery, z.ZodTypeDef, unknown>

export const workspaceMaintenanceQuerySchema = z
  .object({
    ...pagination,
    view: z.enum(WORKSPACE_MAINTENANCE_VIEWS).default('feedback'),
    section: z.enum(WORKSPACE_SECTIONS).default('all')
  })
  .strict() satisfies z.ZodType<
  WorkspaceMaintenanceQuery,
  z.ZodTypeDef,
  unknown
>

const editableLink = patchResourceLinkSchema
  .innerType()
  .extend({
    id: linkHealthIdSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const checked = patchResourceLinkSchema.safeParse(value)
    if (!checked.success)
      checked.error.issues.forEach((issue) => ctx.addIssue(issue))
  })

export const workspaceResourceUpdateSchema = patchResourceSchemaBase
  .omit({ patchId: true, links: true })
  .extend({
    baseLinks: z.array(linkVersionBaseSchema).max(10),
    links: z
      .array(z.union([linkVersionBaseSchema, editableLink]))
      .min(1)
      .max(10)
  })
  .strict()
  .superRefine((data, ctx) => {
    validateResourceTypesBySection(data, ctx)
    validateResourcePlatformsByType(data, ctx)
    validateChineseSupportByType(data, ctx)
    const bases = new Set(data.baseLinks.map((link) => link.id))
    const ids = data.links.flatMap((link) =>
      link.id === undefined ? [] : [link.id]
    )
    if (
      bases.size !== data.baseLinks.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !bases.has(id))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '链接编辑基点不完整或存在重复 ID',
        path: ['baseLinks']
      })
  }) satisfies z.ZodType<WorkspaceResourceUpdateInput, z.ZodTypeDef, unknown>
