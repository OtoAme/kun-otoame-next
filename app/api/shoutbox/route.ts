import { NextRequest, NextResponse } from 'next/server'
import {
  kunParseDeleteQuery,
  kunParseGetQuery,
  kunParsePostBody,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { isPersonalizedApiRequest } from '~/app/api/utils/cacheHeaders'
import {
  shoutboxCreateSchema,
  shoutboxDeleteSchema,
  shoutboxListSchema,
  shoutboxUpdateSchema
} from '~/validations/shoutbox'
import {
  createShoutbox,
  deleteShoutbox,
  getShoutboxHome,
  getShoutboxList,
  MoemoepointInsufficientError,
  updateShoutbox
} from './service'
import { getShoutboxCacheControl } from './cache'
import { toShoutboxReadError } from './errors'

const noStore = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, shoutboxListSchema)
  if (typeof input === 'string') return NextResponse.json(input)
  const personalized = isPersonalizedApiRequest(req)
  const scope = input.patch ? 'patch' : 'global'
  try {
    const visibilityWhere = await getPatchVisibilityWhere(req)
    const response =
      input.view === 'home'
        ? await getShoutboxHome({ visibilityWhere })
        : await getShoutboxList(input, { visibilityWhere })
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': getShoutboxCacheControl(
          response.validUntil,
          personalized
        )
      }
    })
  } catch (error) {
    const readError = toShoutboxReadError(error, scope)
    return NextResponse.json(readError.message, {
      status: 503,
      headers: {
        'Cache-Control': 'private, no-store',
        'Retry-After': String(readError.retryAfterSeconds)
      }
    })
  }
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, shoutboxCreateSchema)
  if (typeof input === 'string') return noStore(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return noStore('用户未登录')
  try {
    return noStore(await createShoutbox(input, payload.uid))
  } catch (error) {
    if (error instanceof MoemoepointInsufficientError) {
      return noStore('可用萌萌点不足')
    }
    throw error
  }
}

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, shoutboxUpdateSchema)
  if (typeof input === 'string') return noStore(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return noStore('用户未登录')
  return noStore(await updateShoutbox(input, payload.uid))
}

export const DELETE = async (req: NextRequest) => {
  const input = kunParseDeleteQuery(req, shoutboxDeleteSchema)
  if (typeof input === 'string') return noStore(input)
  const payload = await verifyHeaderCookie(req)
  if (!payload) return noStore('用户未登录')
  return noStore(await deleteShoutbox(input, payload.uid))
}
