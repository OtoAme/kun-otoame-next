import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRealtimePatchStats } from '~/app/api/patch/views/buffer'

const STATS_CACHE_CONTROL = 'private, no-store'
const uniqueIdSchema = z.string().regex(/^[A-Za-z0-9]{8}$/)

const jsonNoStore = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': STATS_CACHE_CONTROL
    }
  })

export const GET = async (req: Request) => {
  const url = new URL(req.url)
  const uniqueIds = url.searchParams
    .get('uniqueIds')
    ?.split(',')
    .map((uniqueId) => uniqueId.trim())
    .filter(Boolean)

  const input = z.array(uniqueIdSchema).max(50).safeParse(uniqueIds)
  if (!input.success) {
    return jsonNoStore('非法统计请求', 400)
  }

  const realtimeStats = await getRealtimePatchStats(input.data)
  const stats: Record<string, { view?: number; download?: number }> = {}

  input.data.forEach((uniqueId) => {
    const view = realtimeStats.view.get(uniqueId)
    const download = realtimeStats.download.get(uniqueId)
    if (view === undefined && download === undefined) {
      return
    }

    stats[uniqueId] = {
      ...(view !== undefined ? { view } : {}),
      ...(download !== undefined ? { download } : {})
    }
  })

  return jsonNoStore({ stats })
}
