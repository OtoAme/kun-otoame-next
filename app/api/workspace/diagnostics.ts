import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import { workspaceValidationFeedback } from '~/validations/workspaceFeedback'

type Context = {
  requestId: string
  operation: string
  route: string
  write: boolean
  actorId?: number
  resourceId?: number
  patchId?: number
  linkId?: number
}
export const workspaceDiagnosticScope = new AsyncLocalStorage<Context>()
export const newWorkspaceRequestId = (): string => randomUUID()
const numeric = (value: unknown) =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 2147483647
    ? value
    : undefined

export const createWorkspaceDiagnostics = (
  req: NextRequest,
  write: boolean
): Context => {
  const path = req.nextUrl.pathname
  const context: Context = {
    requestId: newWorkspaceRequestId(),
    operation: 'workspace.request',
    route: '/api/workspace/[unknown]',
    write
  }
  if (path === '/api/workspace/entries') {
    context.route = path
    context.operation = 'entries.list'
  } else if (path === '/api/workspace/resources') {
    context.route = path
    context.operation = 'resources.list'
  } else if (path.startsWith('/api/workspace/resources/')) {
    context.route = '/api/workspace/resources/[id]'
    context.operation =
      (
        {
          GET: 'resource.read',
          PUT: 'resource.update',
          DELETE: 'resource.delete'
        } as Record<string, string>
      )[req.method] ?? 'resource.request'
    const id = path.slice('/api/workspace/resources/'.length)
    if (/^[1-9]\d*$/.test(id)) context.resourceId = numeric(Number(id))
  } else if (path === '/api/workspace/maintenance') {
    context.route = path
    context.operation = write ? 'maintenance.action' : 'maintenance.list'
  }
  return context
}

const codes = new Set([
  'invalid_type',
  'invalid_literal',
  'custom',
  'invalid_union',
  'invalid_union_discriminator',
  'invalid_enum_value',
  'unrecognized_keys',
  'invalid_arguments',
  'invalid_return_type',
  'invalid_date',
  'invalid_string',
  'too_small',
  'too_big',
  'invalid_intersection_types',
  'not_multiple_of',
  'not_finite'
])
export class WorkspaceValidationError extends Error {
  readonly feedback
  readonly validationCodes
  constructor(error: z.ZodError) {
    const feedback = workspaceValidationFeedback(error)
    super(feedback.message)
    this.feedback = feedback
    this.validationCodes = [
      ...new Set(
        error.issues
          .slice(0, 32)
          .map((issue) => (codes.has(issue.code) ? issue.code : 'custom'))
      )
    ].slice(0, 8)
  }
}

/** Read only validated numeric identifiers; never retain the parsed payload. */
export const observeWorkspaceInput = (input: unknown) => {
  const context = workspaceDiagnosticScope.getStore()
  if (
    !context ||
    context.operation !== 'maintenance.action' ||
    !input ||
    typeof input !== 'object'
  )
    return
  const value = input as Record<string, unknown>
  context.resourceId = numeric(value.resourceId)
  context.patchId = numeric(value.patchId)
  context.linkId = numeric(value.linkId)
}

const identity = (context: Context) => ({
  requestId: context.requestId,
  operation: context.operation,
  route: context.route,
  ...(numeric(context.actorId) ? { actorId: context.actorId } : {}),
  ...(numeric(context.resourceId) ? { resourceId: context.resourceId } : {}),
  ...(numeric(context.patchId) ? { patchId: context.patchId } : {}),
  ...(numeric(context.linkId) ? { linkId: context.linkId } : {})
})

export const logWorkspaceResult = (
  context: Context,
  status: number,
  result:
    | 'success'
    | 'denied'
    | 'rejected'
    | 'validation_rejected'
    | 'invalid_json'
    | 'unavailable',
  validation?: WorkspaceValidationError
) => {
  if (status < 400 && !context.write) return
  const record = {
    ...identity(context),
    status,
    result,
    ...(validation
      ? {
          validationPaths: validation.feedback.fields.map(
            (field) => field.path
          ),
          validationCodes: validation.validationCodes
        }
      : {})
  }
  if (status >= 500) console.error('[Workspace]', record)
  else if (status >= 400) console.warn('[Workspace]', record)
  else console.info('[Workspace]', record)
}

/** Cleanup errors may contain object URLs, signed tokens or local paths. */
export const logResourceFailure = (
  operation:
    | 'delete_link.invalid_location'
    | 'upload.finalize_failed'
    | 'upload.cleanup_failed',
  context?: { userId?: number; patchId?: number; resourceId?: number },
  itemIndex?: number
) => {
  const current = workspaceDiagnosticScope.getStore()
  console.error('[Resource]', {
    ...(current ? identity(current) : {}),
    operation,
    result: 'failed',
    ...(numeric(context?.userId) ? { actorId: context!.userId } : {}),
    ...(numeric(context?.patchId) ? { patchId: context!.patchId } : {}),
    ...(numeric(context?.resourceId)
      ? { resourceId: context!.resourceId }
      : {}),
    ...(typeof itemIndex === 'number' &&
    Number.isSafeInteger(itemIndex) &&
    itemIndex >= 0
      ? { itemIndex }
      : {})
  })
}
