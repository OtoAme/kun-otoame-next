import { NextResponse } from 'next/server'
import type { KunGalgamePayload } from '~/app/api/utils/jwt'
import { getSessionContext } from '~/app/api/utils/sessionIdentity'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'

// Older clients omit this precondition. Authorization still uses the verified cookie.
export const checkChatSession = (req: Request, payload: KunGalgamePayload) => {
  const expected = req.headers.get('X-Kun-Chat-Session')
  if (expected === null || expected === getSessionContext(payload)) return null
  return NextResponse.json(
    { code: 'SESSION_CHANGED', message: '登录状态已变化，请重新确认当前对话' },
    {
      status: 401,
      headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
    }
  )
}
