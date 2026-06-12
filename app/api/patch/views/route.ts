import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updatePatchViews } from './put'

const VIEW_CACHE_CONTROL = 'private, no-store'

const viewSchema = z.object({
  uniqueId: z.string().regex(/^[A-Za-z0-9]{8}$/),
  currentView: z.number().int().min(0).optional()
})

const jsonNoStore = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': VIEW_CACHE_CONTROL
    }
  })

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null)
  const input = viewSchema.safeParse(body)
  if (!input.success) {
    return jsonNoStore('非法浏览量请求', 400)
  }

  await updatePatchViews(input.data.uniqueId, input.data.currentView)

  return jsonNoStore({})
}
