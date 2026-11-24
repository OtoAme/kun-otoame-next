import { KUN_SITE_THEME_STORAGE_KEY } from '~/constants/theme'
import {
  TEMP_2FA_COOKIE,
  RESOURCE_ACCESS_VISITOR_COOKIE,
  DASHBOARD_SIDEBAR_COOKIE
} from '~/utils/cookies'
import type { NextResponse } from 'next/server'

const sessionCookies = [
  'kun-galgame-patch-moe-token',
  'kun-patch-setting-store|state|data|kunNsfwEnable',
  'kun-patch-setting-store|state|data|kunBlockedTagIds'
]
const siteCookies = [
  ...sessionCookies,
  TEMP_2FA_COOKIE,
  RESOURCE_ACCESS_VISITOR_COOKIE,
  KUN_SITE_THEME_STORAGE_KEY,
  DASHBOARD_SIDEBAR_COOKIE
]

export const clearSessionCookies = (
  response: NextResponse,
  scope: 'session' | 'site' = 'session'
) => {
  for (const name of scope === 'site' ? siteCookies : sessionCookies) {
    response.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      expires: new Date(0)
    })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
