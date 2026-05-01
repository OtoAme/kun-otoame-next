import { NextRequest, NextResponse } from 'next/server'
import { kunParseFormData } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { updatePatchBannerSchema } from '~/validations/patch'
import { updatePatchBanner } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParseFormData(req, updatePatchBannerSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  if (payload.role < 3) {
    return NextResponse.json('本页面仅管理员可访问')
  }

  const image = await new Response(input.image)?.arrayBuffer()
  const originalImage = input.imageOriginal
    ? await new Response(input.imageOriginal)?.arrayBuffer()
    : undefined

  const response = await updatePatchBanner(image, input.patchId, originalImage)
  return NextResponse.json(response)
}
