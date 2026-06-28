import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { importRemoteGalleryImage } from '~/app/api/edit/galleryRemoteImport'

const remoteGalleryImageSchema = z.object({
  url: z.string().url('图片地址格式不正确').max(2048)
})

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, remoteGalleryImageSchema)
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

  const result = await importRemoteGalleryImage(input.url)
  return NextResponse.json(result)
}
