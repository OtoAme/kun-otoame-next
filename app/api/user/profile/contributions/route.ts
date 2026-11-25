import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { formatShanghaiCalendarDate } from '~/utils/moemoepointDateRange'
import { getProfileContributions } from './service'

const query = z.object({
  uid: z.coerce.number().int().positive().max(9999999),
  year: z.coerce
    .number()
    .int()
    .min(1000)
    .refine(
      (year) =>
        year <= Number(formatShanghaiCalendarDate(new Date()).slice(0, 4))
    )
    .optional()
})

export async function GET(req: NextRequest) {
  const viewer = await verifyHeaderCookie(req)
  if (!viewer?.uid) return NextResponse.json('请先登录', { status: 401 })
  const input = kunParseGetQuery(req, query)
  if (typeof input === 'string') {
    return NextResponse.json('用户或年份无效', { status: 400 })
  }
  const visibility = await getPatchVisibilityWhere(req)
  const days = await getProfileContributions(input.uid, input.year, visibility)
  return NextResponse.json(days, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
}
