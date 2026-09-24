import { NextRequest } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import type { CompanyMergeDetectStreamEvent } from '~/types/api/companyMerges'
import { companyMergeJson } from '../response'
import { detectCompanyMergeSuggestions } from '../service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return companyMergeJson('用户未登录')
  if (payload.role < 3) return companyMergeJson('本页面仅管理员可访问')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: CompanyMergeDetectStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      try {
        const result = await detectCompanyMergeSuggestions({
          onProgress: (event) => send({ type: 'progress', ...event })
        })
        send({ type: 'done', ...result })
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[company-merges:detect] stream failed:', error)
        send({ type: 'error', message: '检测失败，请稍后重试' })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
}
