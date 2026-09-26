import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { CASE_IMAGE_SIZE_LIMIT_MESSAGE, uploadCaseImage } from '../imageUpload'
import { checkCaseRateLimit } from '../rateLimit'

const MIDDLEWARE_CLIENT_MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024

const jsonNoStore = (body: unknown, status?: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
  })

const contentLengthOverLimit = (req: NextRequest) => {
  const parsed = Number(req.headers.get('content-length'))
  return (
    Number.isSafeInteger(parsed) &&
    parsed > MIDDLEWARE_CLIENT_MAX_BODY_SIZE_BYTES
  )
}

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) return jsonNoStore('用户未登录')

  const intakeLimited = await checkCaseRateLimit(
    'image-upload-intake',
    payload.uid
  )
  if (intakeLimited) return jsonNoStore(intakeLimited, 429)
  if (contentLengthOverLimit(req)) {
    return jsonNoStore(CASE_IMAGE_SIZE_LIMIT_MESSAGE, 413)
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return jsonNoStore('图片上传请求解析失败，请稍后重试', 400)
  }
  const image = formData.get('image')
  if (!(image instanceof File)) return jsonNoStore('请上传图片')

  const result = await uploadCaseImage(image, payload.uid)
  return jsonNoStore(
    result,
    result === CASE_IMAGE_SIZE_LIMIT_MESSAGE ? 413 : undefined
  )
}
