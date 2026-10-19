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

export const workspaceJson = (
  body: unknown,
  status = 200,
  retryAfter?: number
) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': WORKSPACE_CACHE_CONTROL,
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {})
    }
  })

export const workspaceRequest = async (
  req: NextRequest,
  run: (user: WorkspaceUser) => Promise<unknown>,
  write = false
) => {
  const user = await verifyHeaderCookie(req)
  if (!user)
    return workspaceJson(E.login_required.message, E.login_required.status)
  if (write && verifyKunCsrf(req))
    return workspaceJson(E.forbidden.message, E.forbidden.status)
  const limited = await checkLinkHealthRateLimit(user.uid)
  if (limited)
    return workspaceJson(LINK_HEALTH_ERRORS.rate_limited.message, 429, limited)
  try {
    const result = await run({ id: user.uid, role: user.role, name: user.name })
    if (typeof result === 'string') {
      const known = [
        ...Object.values(E),
        ...Object.values(LINK_HEALTH_ERRORS),
        ...Object.values(LINK_MAINTENANCE_ERRORS)
      ].find((error) => error.message === result)
      return workspaceJson(result, known?.status ?? 400)
    }
    return workspaceJson(result)
  } catch (error) {
    if (error instanceof ResourceMutationError)
      return workspaceJson(error.message, error.status)
    if (error instanceof SyntaxError)
      return workspaceJson(E.invalid_request.message, E.invalid_request.status)
    console.error('[Workspace] Request unavailable')
    return workspaceJson(E.unavailable.message, E.unavailable.status)
  }
}

export const workspaceQuery = <S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S
): z.output<S> => {
  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success)
    throw new ResourceMutationError(E.invalid_request.message, 400)
  return parsed.data
}

export const workspaceBody = async <S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S
): Promise<z.output<S>> => {
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success)
    throw new ResourceMutationError(E.invalid_request.message, 400)
  return parsed.data
}
