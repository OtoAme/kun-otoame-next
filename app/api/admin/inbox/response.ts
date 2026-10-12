import { NextResponse } from 'next/server'

export const inboxJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const inboxReadJson = async (read: () => Promise<unknown>) => {
  try {
    return inboxJson(await read())
  } catch {
    console.error('[Inbox] Read unavailable')
    return inboxJson('事项读取暂时不可用，请稍后再试', 503)
  }
}
