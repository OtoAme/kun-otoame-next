import { NextRequest, NextResponse } from 'next/server'
import { kunParseFormData } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { imageSchema } from '~/validations/edit'
import { uploadImage } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParseFormData(req, imageSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const image = await new Response(input.image)?.arrayBuffer()

  const res = await uploadImage(payload.uid, image)
  return NextResponse.json(res)
}
