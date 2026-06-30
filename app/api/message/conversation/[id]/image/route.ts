import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { uploadConversationImage } from './service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: {
      'Cache-Control': PERSONALIZED_API_CACHE_CONTROL
    }
  })

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonNoStore(csrfError)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonNoStore('用户未登录')
  }

  const { id } = await params
  const conversationId = Number(id)
  if (!Number.isInteger(conversationId)) {
    return jsonNoStore('无效的会话 ID')
  }

  const formData = await req.formData()
  const image = formData.get('image')
  if (!(image instanceof File)) {
    return jsonNoStore('请上传图片')
  }

  const response = await uploadConversationImage(
    conversationId,
    image,
    payload.uid
  )
  return jsonNoStore(response)
}
