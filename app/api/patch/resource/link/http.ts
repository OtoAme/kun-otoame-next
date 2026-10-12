import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import {
  LINK_HEALTH_CACHE_CONTROL,
  LINK_HEALTH_ERRORS as E
} from '~/constants/linkHealth'
import { ResourceMutationError } from '../mutation'
import { checkLinkHealthRateLimit } from './rateLimit'
import type { HealthActor } from './service'
import type { Prisma } from '@prisma/client'

export const linkHealthJson = (
  body: unknown,
  status = 200,
  retryAfter?: number
) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': LINK_HEALTH_CACHE_CONTROL,
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {})
    }
  })
export const healthWrite = async <S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
  run: (
    input: z.output<S>,
    actor: HealthActor,
    visibility: Prisma.patchWhereInput
  ) => Promise<unknown>,
  minRole = 1,
  report = false
) => {
  const user = await verifyHeaderCookie(req)
  if (!user) return linkHealthJson(E.login_required.message, 401)
  if (user.role < minRole) return linkHealthJson(E.forbidden.message, 403)
  if (verifyKunCsrf(req)) return linkHealthJson(E.forbidden.message, 403)
  const limited = await checkLinkHealthRateLimit(user.uid)
  if (limited) return linkHealthJson(E.rate_limited.message, 429, limited)
  try {
    const raw = await req.json()
    if (report && raw?.reason === 'slow')
      return linkHealthJson(E.slow_is_not_failure.message, 400)
    if (
      report &&
      raw?.reason === 'unreachable' &&
      raw?.networkAcknowledged !== true
    )
      return linkHealthJson(E.network_confirmation_required.message, 400)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return linkHealthJson(E.invalid_request.message, 400)
    const visibility = await getPatchVisibilityWhere(req)
    return linkHealthJson(
      await run(parsed.data, { uid: user.uid, role: user.role }, visibility)
    )
  } catch (error) {
    if (error instanceof SyntaxError)
      return linkHealthJson(E.invalid_request.message, 400)
    if (error instanceof ResourceMutationError)
      return linkHealthJson(error.message, error.status)
    console.error('[LinkHealth] Mutation unavailable')
    return linkHealthJson(E.unavailable.message, 503)
  }
}
export const healthRead = async <S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
  run: (
    input: z.output<S>,
    actor: HealthActor,
    visibility: Prisma.patchWhereInput
  ) => Promise<unknown>,
  minRole = 1
) => {
  const user = await verifyHeaderCookie(req)
  if (!user) return linkHealthJson(E.login_required.message, 401)
  if (user.role < minRole) return linkHealthJson(E.forbidden.message, 403)
  const limited = await checkLinkHealthRateLimit(user.uid)
  if (limited) return linkHealthJson(E.rate_limited.message, 429, limited)
  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return linkHealthJson(E.invalid_request.message, 400)
  try {
    return linkHealthJson(
      await run(
        parsed.data,
        { uid: user.uid, role: user.role },
        await getPatchVisibilityWhere(req)
      )
    )
  } catch {
    console.error('[LinkHealth] Read unavailable')
    return linkHealthJson(E.unavailable.message, 503)
  }
}
