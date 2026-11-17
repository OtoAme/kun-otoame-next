import type { NextResponse } from 'next/server'

export const clearSessionCookies = (response: NextResponse) => {
  for (const name of [
    'kun-galgame-patch-moe-token',
    'kun-patch-setting-store|state|data|kunNsfwEnable',
    'kun-patch-setting-store|state|data|kunBlockedTagIds'
  ]) {
    response.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      expires: new Date(0)
    })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
