import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { shoutboxReportSchema } from '~/validations/shoutbox'
import { createReport } from './service'

const noStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, shoutboxReportSchema)
  if (typeof input === 'string') return noStore(input)

  const payload = await verifyHeaderCookie(req)
  if (!payload) return noStore('用户未登录')

  return noStore(await createReport(input, payload.uid))
}
