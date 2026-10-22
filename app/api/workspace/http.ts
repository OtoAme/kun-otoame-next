import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import {
  WORKSPACE_CACHE_CONTROL,
  WORKSPACE_ERRORS as E
} from '~/constants/workspace'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { LINK_MAINTENANCE_ERRORS } from '~/constants/linkMaintenance'
import { ResourceMutationError } from '~/app/api/patch/resource/mutation'
import { checkLinkHealthRateLimit } from '~/app/api/patch/resource/link/rateLimit'
import type { WorkspaceUser } from '~/types/api/workspace'
import {
  createWorkspaceDiagnostics,
  logWorkspaceResult,
  newWorkspaceRequestId,
  observeWorkspaceInput,
  workspaceDiagnosticScope,
  WorkspaceValidationError
} from './diagnostics'

class WorkspaceJsonSyntaxError extends Error {}

export const workspaceJson = (
  body: unknown,
  status = 200,
  retryAfter?: number,
  requestId = newWorkspaceRequestId()
) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': WORKSPACE_CACHE_CONTROL,
      'X-Request-Id': requestId,
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {})
    }
  })

export const workspaceRequest = async (
  req: NextRequest,
  run: (user: WorkspaceUser) => Promise<unknown>,
  write = false
) => {
  const context = createWorkspaceDiagnostics(req, write)
  return workspaceDiagnosticScope.run(context, async () => {
    const respond = (
      body: unknown,
      status = 200,
      retryAfter?: number,
      result: Parameters<typeof logWorkspaceResult>[2] = status < 400
        ? 'success'
        : 'rejected',
      validation?: WorkspaceValidationError
    ) => {
      logWorkspaceResult(context, status, result, validation)
      const value =
        status >= 500 && typeof body === 'string'
          ? `${body}（参考编号：${context.requestId}）`
          : body
      return workspaceJson(value, status, retryAfter, context.requestId)
    }
    try {
      const user = await verifyHeaderCookie(req)
      if (!user)
        return respond(
          E.login_required.message,
          E.login_required.status,
          undefined,
          'denied'
        )
      context.actorId = user.uid
      if (write && verifyKunCsrf(req))
        return respond(
          E.forbidden.message,
          E.forbidden.status,
          undefined,
          'denied'
        )
      const limited = await checkLinkHealthRateLimit(user.uid)
      if (limited)
        return respond(
          LINK_HEALTH_ERRORS.rate_limited.message,
          429,
          limited,
          'denied'
        )
      const result = await run({
        id: user.uid,
        role: user.role,
        name: user.name
      })
      if (typeof result === 'string') {
        const known = [
          ...Object.values(E),
          ...Object.values(LINK_HEALTH_ERRORS),
          ...Object.values(LINK_MAINTENANCE_ERRORS)
        ].find((error) => error.message === result)
        return respond(result, known?.status ?? 400)
      }
      return respond(result)
    } catch (error) {
      if (error instanceof WorkspaceValidationError)
        return respond(
          error.message,
          400,
          undefined,
          'validation_rejected',
          error
        )
      if (error instanceof ResourceMutationError)
        return respond(error.message, error.status)
      if (error instanceof WorkspaceJsonSyntaxError)
        return respond(
          E.invalid_request.message,
          E.invalid_request.status,
          undefined,
          'invalid_json'
        )
      return respond(
        E.unavailable.message,
        E.unavailable.status,
        undefined,
        'unavailable'
      )
    }
  })
}

export const workspaceQuery = <S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S
): z.output<S> => {
  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) throw new WorkspaceValidationError(parsed.error)
  return parsed.data
}

export const workspaceBody = async <S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S
): Promise<z.output<S>> => {
  let raw: unknown
  try {
    raw = await req.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new WorkspaceJsonSyntaxError()
    throw error
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new WorkspaceValidationError(parsed.error)
  observeWorkspaceInput(parsed.data)
  return parsed.data
}
