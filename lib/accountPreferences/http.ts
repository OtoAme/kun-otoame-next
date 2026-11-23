import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '~/prisma'
import {
  getRequestIdentity,
  getSessionContext,
  requireAvailableIdentity
} from '~/app/api/utils/sessionIdentity'
import { preferenceSaveSchema } from '~/validations/preferences'
import {
  PreferenceError,
  readPreferenceSnapshot,
  saveAccountPreferences
} from './service'

const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const preferenceRoute = async (
  req: NextRequest,
  save: boolean,
  allowedPrefix?: string
) => {
  try {
    const payload = requireAvailableIdentity(await getRequestIdentity(req))
    if (!payload)
      return respond({ code: 'SESSION_INVALID', message: '请先登录' }, 401)
    const context = getSessionContext(payload)
    if (!save) {
      const tagIds = req.nextUrl.searchParams.getAll('tagId')
      if (
        tagIds.length > 100 ||
        tagIds.some((tagId) => !/^[1-9]\d{0,8}$/.test(tagId))
      ) {
        return respond(
          { code: 'PREFERENCE_INVALID', message: '标签编号非法' },
          400
        )
      }
      return respond(
        await readPreferenceSnapshot(
          prisma,
          payload.uid,
          context,
          tagIds.map((tagId) => `blocked-tag:${tagId}`)
        )
      )
    }
    const input = preferenceSaveSchema.safeParse(
      await req.json().catch(() => null)
    )
    if (
      !input.success ||
      (allowedPrefix &&
        input.data.changes.some(
          (change) => !change.key.startsWith(allowedPrefix)
        ))
    ) {
      return respond(
        { code: 'PREFERENCE_INVALID', message: '请刷新设置页后重新选择' },
        400
      )
    }
    if (input.data.uid !== payload.uid || input.data.context !== context) {
      return respond(
        {
          code: 'PREFERENCE_CONTEXT_CHANGED',
          message: '登录账号或会话已变化，请重新确认草稿'
        },
        409
      )
    }
    const result = await saveAccountPreferences(
      prisma,
      payload.uid,
      context,
      input.data.changes
    )
    return respond(result, 'code' in result ? 409 : 200)
  } catch (error) {
    if (error instanceof PreferenceError)
      return respond({ code: error.code, message: error.message }, error.status)
    return respond(
      { code: 'PREFERENCE_UNAVAILABLE', message: '设置暂时不可用，请稍后重试' },
      503
    )
  }
}
